const { createHash } = require("node:crypto");
const { mkdir, open, readFile, rename, rm } = require("node:fs/promises");
const path = require("node:path");

const REPOSITORY = "samanjoy2/hf-manual";
const MAX_SIZE = 512 * 1024 * 1024;

function stableVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  return match ? match.slice(1).map(Number) : null;
}

function newerVersion(candidate, current) {
  const next = stableVersion(candidate);
  const previous = stableVersion(current);
  if (!next || !previous) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== previous[i]) return next[i] > previous[i];
  }
  return false;
}

function releaseAsset(release, name) {
  const asset = release.assets?.find((item) => item.name === name);
  const expected = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${name}`;
  if (!asset || asset.browser_download_url !== expected) throw new Error("The release is missing a valid Windows installer or checksum.");
  return asset;
}

function checksumValue(text, filename) {
  const line = String(text).trim();
  const match = /^([a-fA-F0-9]{64})\s+\*?([^\r\n]+)$/.exec(line);
  if (!match || match[2] !== filename) throw new Error("The release checksum file is invalid.");
  return match[1].toLowerCase();
}

class UpdateService {
  constructor({ version, directory, enabled, emit, fetcher = fetch }) {
    this.version = version;
    this.directory = directory;
    this.enabled = enabled;
    this.emit = emit;
    this.fetcher = fetcher;
    this.state = { status: "idle", currentVersion: version, message: enabled ? "Updates are checked automatically." : "Update installation is available in the installed Windows app." };
    this.release = null;
    this.installer = null;
    this.operation = null;
  }

  setState(state) {
    this.state = { currentVersion: this.version, ...state };
    this.emit(this.state);
    return this.state;
  }

  async request(url, timeout = 30_000) {
    const response = await this.fetcher(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "HF-Access-Desk" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429
      ? "GitHub is limiting update checks. Try again later."
      : `GitHub update request failed (HTTP ${response.status}).`);
    return response;
  }

  check() {
    if (this.operation) return this.operation;
    if (["downloaded", "installing"].includes(this.state.status)) return Promise.resolve(this.state);
    this.operation = this.checkRelease().finally(() => { this.operation = null; });
    return this.operation;
  }

  async checkRelease() {
    this.setState({ status: "checking", message: "Checking GitHub for updates…" });
    try {
      const release = await (await this.request(`https://api.github.com/repos/${REPOSITORY}/releases/latest`)).json();
      if (release.draft || release.prerelease || !stableVersion(release.tag_name)) throw new Error("GitHub did not return a stable release.");
      if (!newerVersion(release.tag_name, this.version)) {
        this.release = null;
        return this.setState({ status: "current", message: `Version ${this.version} is up to date.`, checkedAt: new Date().toISOString() });
      }
      const version = release.tag_name.replace(/^v/, "");
      const filename = `HF-Access-Desk-Setup-${version}.exe`;
      const installer = releaseAsset(release, filename);
      const checksum = releaseAsset(release, `${filename}.sha256`);
      if (!Number.isInteger(installer.size) || installer.size <= 0 || installer.size > MAX_SIZE) throw new Error("The release installer has an invalid size.");
      this.release = { version, filename, installer, checksum };
      return this.setState({ status: "available", version, message: `Version ${version} is available.`, canInstall: this.enabled });
    } catch (error) {
      return this.setState({ status: "error", message: error.message });
    }
  }

  download() {
    if (this.operation) return this.operation;
    if (this.state.status === "downloaded") return Promise.resolve(this.state);
    if (!this.enabled || !this.release) throw new Error("Check for updates in the installed Windows app first.");
    this.operation = this.downloadRelease().finally(() => { this.operation = null; });
    return this.operation;
  }

  async downloadRelease() {
    const release = this.release;
    const destination = path.join(this.directory, release.filename);
    const temporary = `${destination}.part`;
    let file;
    try {
      this.setState({ status: "downloading", version: release.version, progress: 0, message: "Downloading update…" });
      const checksumResponse = await this.request(release.checksum.browser_download_url);
      const expectedHash = checksumValue(await checksumResponse.text(), release.filename);
      const response = await this.request(release.installer.browser_download_url, 15 * 60_000);
      if (!response.body) throw new Error("The update download is empty.");
      await mkdir(this.directory, { recursive: true });
      file = await open(temporary, "w", 0o600);
      const hash = createHash("sha256");
      let received = 0;
      let reported = -1;
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > release.installer.size || received > MAX_SIZE) throw new Error("The update download exceeded the expected size.");
        hash.update(chunk);
        await file.writeFile(chunk);
        const progress = Math.floor(received / release.installer.size * 100);
        if (progress !== reported) {
          reported = progress;
          this.setState({ status: "downloading", version: release.version, progress, message: `Downloading update… ${progress}%` });
        }
      }
      await file.close();
      file = null;
      if (received !== release.installer.size || hash.digest("hex") !== expectedHash) throw new Error("Update verification failed. The installer was not saved. Please retry.");
      await rename(temporary, destination);
      this.installer = destination;
      this.installerHash = expectedHash;
      return this.setState({ status: "downloaded", version: release.version, message: "Update verified and ready. Install to close the app and run the installer.", canInstall: true });
    } catch (error) {
      if (file) await file.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      this.installer = null;
      return this.setState({ status: "error", version: release.version, message: error.message });
    }
  }

  async prepareInstall() {
    if (!this.enabled || this.state.status !== "downloaded" || !this.installer) throw new Error("Download and verify an update before installing it.");
    const hash = createHash("sha256").update(await readFile(this.installer)).digest("hex");
    if (hash !== this.installerHash) {
      this.installer = null;
      this.setState({ status: "error", message: "The downloaded installer changed. Download the update again." });
      throw new Error(this.state.message);
    }
    return this.installer;
  }
}

module.exports = { UpdateService, newerVersion, checksumValue };
