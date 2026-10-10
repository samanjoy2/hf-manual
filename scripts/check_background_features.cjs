const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdtemp, readFile, writeFile, readdir, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { observeRequests } = require("../electron/request-monitor.cjs");
const { UpdateService, newerVersion, checksumValue } = require("../electron/updates.cjs");

const request = (username, time = "2026-10-07T00:00:00Z", status = "pending") => ({ repoId: "sample-lab/data", username, requestedAt: time, status });
const overview = (requests, username = "owner") => ({ account: { username }, requests });

test("first-run baseline, new arrivals, resubmissions, and account changes", () => {
  const initial = observeRequests(null, overview([request("old")]));
  assert.equal(initial.added.length, 0);
  const next = observeRequests(initial.snapshot, overview([request("old"), request("new")]));
  assert.deepEqual(next.added.map((item) => item.username), ["new"]);
  assert.equal(observeRequests(next.snapshot, overview([request("new")])).added.length, 0);
  assert.equal(observeRequests(next.snapshot, overview([request("old", "2026-10-08T00:00:00Z")])).added.length, 1);
  assert.equal(observeRequests(next.snapshot, overview([request("another")], "different-owner")).added.length, 0);
});

test("decisions and temporarily missing requests do not trigger duplicate alerts", () => {
  const initial = observeRequests(null, overview([request("old", undefined, "accepted")]));
  const empty = observeRequests(initial.snapshot, overview([]));
  assert.equal(observeRequests(empty.snapshot, overview([request("old")])).added.length, 0);
});

test("version comparison and checksum parser reject unsupported formats", () => {
  assert.equal(newerVersion("v1.10.0", "1.9.9"), true);
  assert.equal(newerVersion("v1.2.0", "1.2.0"), false);
  assert.equal(newerVersion("v1.1.9", "1.2.0"), false);
  assert.equal(newerVersion("v2.0.0-beta", "1.2.0"), false);
  assert.throws(() => checksumValue("bad", "app.exe"));
  assert.throws(() => checksumValue(`${"a".repeat(64)}  other.exe`, "app.exe"));
});

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hf-desk-update-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const content = Buffer.from("fictional test installer; never executed");
  const hash = createHash("sha256").update(content).digest("hex");
  const filename = "HF-Access-Desk-Setup-1.3.0.exe";
  const base = "https://github.com/samanjoy2/hf-manual/releases/download/v1.3.0/";
  const release = { tag_name: "v1.3.0", draft: false, prerelease: false, assets: [
    { name: filename, size: content.length + (options.sizeOffset || 0), browser_download_url: options.url || base + filename },
    { name: `${filename}.sha256`, size: 120, browser_download_url: `${base}${filename}.sha256` },
  ] };
  const statuses = [];
  const fetcher = async (url) => {
    if (options.networkError) throw new Error("Offline");
    if (url.includes("api.github.com")) return new Response(JSON.stringify(release));
    if (url.endsWith(".sha256")) return new Response(`${options.badHash ? "0".repeat(64) : hash}  ${filename}`);
    return new Response(content);
  };
  const service = new UpdateService({ version: "1.2.0", directory, enabled: true, emit: (value) => statuses.push(value), fetcher });
  return { service, directory, content, filename, statuses };
}

test("downloads and verifies the release; re-verifies before installer launch", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.service.check()).status, "available");
  assert.equal((await f.service.download()).status, "downloaded");
  const installer = await f.service.prepareInstall();
  assert.deepEqual(await readFile(installer), f.content);
  assert.equal(f.statuses.some((state) => state.progress === 100), true);
  await writeFile(installer, "tampered");
  await assert.rejects(f.service.prepareInstall(), /changed/);
  assert.equal(f.service.state.status, "error");
});

for (const [label, options] of [["checksum mismatch", { badHash: true }], ["truncated download", { sizeOffset: 1 }], ["oversized download", { sizeOffset: -1 }]]) {
  test(`${label} blocks installation and removes temporary downloads`, async (t) => {
    const f = await fixture(t, options);
    await f.service.check();
    assert.equal((await f.service.download()).status, "error");
    assert.deepEqual(await readdir(f.directory), []);
    await assert.rejects(f.service.prepareInstall());
  });
}

test("foreign download URL and offline checks fail without launching anything", async (t) => {
  const foreign = await fixture(t, { url: "https://example.com/untrusted.exe" });
  assert.equal((await foreign.service.check()).status, "error");
  const offline = await fixture(t, { networkError: true });
  assert.equal((await offline.service.check()).status, "error");
});

test("development builds cannot download or install updates", async (t) => {
  const f = await fixture(t);
  f.service.enabled = false;
  assert.equal((await f.service.check()).canInstall, false);
  assert.throws(() => f.service.download());
  await assert.rejects(f.service.prepareInstall());
});

test("main-process IPC persists preferences, polls, and emits private notifications", async (t) => {
  const vm = require("node:vm");
  const { EventEmitter } = require("node:events");
  const { pathToFileURL } = require("node:url");
  const directory = await mkdtemp(path.join(os.tmpdir(), "hf-desk-main-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.resolve(__dirname, "..");
  const handlers = new Map();
  const timers = new Map();
  const notifications = [];
  const sent = [];
  const backgrounds = [];
  // Existing settings from before theme support must migrate to dark.
  await writeFile(path.join(directory, "settings.json"), JSON.stringify({ refreshMinutes: 5, notifications: true, checkUpdates: true }));
  let pending = [{ username: "existing", time: "2026-10-07T01:00:00Z" }];
  let failPending = false;
  let ready;
  const app = new EventEmitter();
  Object.assign(app, {
    getPath: () => directory, getVersion: () => "1.2.0", isPackaged: true,
    requestSingleInstanceLock: () => true, quit() {}, setAppUserModelId() {},
    whenReady: () => ({ then: (callback) => { ready = callback(); } }),
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      backgrounds.push(options.backgroundColor);
      this.webContents = Object.assign(new EventEmitter(), { send: (channel, value) => sent.push({ channel, value }), setWindowOpenHandler() {} });
    }
    loadFile() {} show() {} focus() {} isDestroyed() { return false; } isMinimized() { return false; }
    setBackgroundColor(color) { backgrounds.push(color); }
  }
  Window.getAllWindows = () => [1];
  class NativeNotification extends EventEmitter {
    constructor(options) { super(); this.options = options; notifications.push(this); }
    static isSupported() { return true; }
    show() {}
  }
  const nativeTheme = new EventEmitter();
  Object.defineProperty(nativeTheme, "shouldUseDarkColors", { get: () => nativeTheme.themeSource !== "light" });
  const electron = {
    app, BrowserWindow: Window, Notification: NativeNotification, nativeTheme,
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (text) => Buffer.from(text), decryptString: (value) => value.toString() },
    shell: { openExternal: async () => {} }, session: { defaultSession: { setPermissionRequestHandler() {} } },
  };
  const fetcher = async (url) => {
    if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "v1.1.0", draft: false, prerelease: false }));
    if (url.includes("whoami")) return new Response(JSON.stringify({ name: "sample-owner" }));
    if (url.includes("datasets?")) return new Response(JSON.stringify([{ id: "sample-lab/data", gated: "manual" }]));
    if (url.endsWith("/pending")) return failPending ? new Response("Unavailable", { status: 503 }) : new Response(JSON.stringify(pending));
    return new Response("[]");
  };
  const context = vm.createContext({
    require: (name) => name === "electron" ? electron : name.startsWith("./") ? require(path.join(root, "electron", name)) : require(name),
    __dirname: path.join(root, "electron"), process, console, Buffer, URL, URLSearchParams, AbortSignal, fetch: fetcher,
    setInterval: (fn, delay) => { timers.set(delay, fn); return delay; }, clearInterval: (id) => timers.delete(id), setTimeout,
  });
  vm.runInContext(await readFile(path.join(root, "electron", "main.cjs"), "utf8"), context);
  await ready;
  const event = { senderFrame: { url: pathToFileURL(path.join(root, "public", "index.html")).href } };
  const call = (channel, ...args) => handlers.get(channel)(event, ...args);
  assert.equal(call("settings:get").theme, "dark");
  assert.equal(nativeTheme.themeSource, "dark");
  assert.equal(backgrounds.at(-1), "#11151c");
  await call("credential:save", "hf_" + "A".repeat(30));
  await call("hub:overview", true);
  assert.equal(notifications.length, 0);
  pending.push({ username: "fictional-new", time: "2026-10-07T02:00:00Z" });
  await timers.get(5 * 60_000)();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].options.title, "1 new dataset access request");
  assert.equal(notifications[0].options.body.includes("fictional-new"), false);
  assert.equal(sent.some((item) => item.channel === "monitor:overview"), true);
  notifications[0].emit("click");
  assert.equal(sent.some((item) => item.channel === "monitor:open-pending"), true);
  failPending = true;
  await timers.get(5 * 60_000)();
  failPending = false;
  await timers.get(5 * 60_000)();
  assert.equal(notifications.length, 1);
  await call("settings:save", { theme: "light", refreshMinutes: 0, notifications: false, checkUpdates: false });
  assert.equal(timers.size, 0);
  const saved = JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8"));
  assert.equal(saved.refreshMinutes, 0);
  assert.equal(saved.theme, "light");
  assert.equal(nativeTheme.themeSource, "light");
  assert.equal(backgrounds.at(-1), "#ffffff");
  pending.push({ username: "silent-new", time: "2026-10-07T03:00:00Z" });
  await call("hub:overview", true);
  assert.equal(notifications.length, 1);
  await call("settings:save", { ...saved, theme: "system" });
  assert.equal(nativeTheme.themeSource, "system");
  await call("settings:save", { ...saved, theme: "invalid" });
  assert.equal(call("settings:get").theme, "dark");
  assert.throws(() => handlers.get("settings:get")({ senderFrame: { url: "https://example.com" } }), /Untrusted/);
});
