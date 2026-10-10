const { existsSync } = require("node:fs");
const { mkdir, mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "docs", "screenshots");
const pageUrl = pathToFileURL(path.join(root, "public", "index.html")).href;
const browser = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);

if (!browser) throw new Error("Microsoft Edge or Google Chrome is required to capture screenshots.");

async function capture(name, query, profileRoot) {
  const screenshot = path.join(output, `${name}.png`);
  const profile = path.join(profileRoot, name);
  const result = spawnSync(browser, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-gpu-sandbox",
    "--disable-software-rasterizer",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--virtual-time-budget=1200",
    "--window-size=1440,900",
    `--user-data-dir=${profile}`,
    `--screenshot=${screenshot}`,
    `${pageUrl}?${query}`,
  ], { stdio: "inherit" });
  if (result.status !== 0 || !existsSync(screenshot)) throw new Error(`Could not capture ${name}.png.`);
}

(async () => {
  await mkdir(output, { recursive: true });
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "hf-access-desk-shots-"));
  try {
    await capture("dashboard", "demo=dashboard", profileRoot);
    await capture("token-setup", "demo=setup", profileRoot);
    await capture("sidebar-collapsed", "demo=dashboard&sidebar=collapsed", profileRoot);
    await capture("request-details", "demo=dashboard&details=pending-01", profileRoot);
    await capture("audit-log", "demo=dashboard&audit=1", profileRoot);
    await capture("settings-updates", "demo=dashboard&settings=1", profileRoot);
  } finally {
    await rm(profileRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
