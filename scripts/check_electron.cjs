// Hidden Electron smoke check; no real token, account, or user profile is used.
const { app, BrowserWindow } = require("electron");
const { mkdtemp, rm } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { setTimeout: delay } = require("node:timers/promises");

(async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "hf-access-desk-electron-check-"));
  app.setPath("userData", profile);
  let window;
  try {
    await app.whenReady();
    window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    const packaged = process.argv.includes("--packaged");
    const index = path.resolve(__dirname, packaged ? "../dist/win-unpacked/resources/app.asar/public/index.html" : "../public/index.html");
    await window.loadFile(index, { query: { demo: "dashboard", analytics: "1" } });
    let result;
    for (let i = 0; i < 100; i++) {
      result = await window.webContents.executeJavaScript(`({ rows: document.querySelector('#analyticsRows')?.children.length, hidden: document.querySelector('#analyticsContent')?.classList.contains('hidden'), theme: document.documentElement.dataset.theme, error: document.querySelector('#tokenError')?.textContent })`);
      if (result.rows === 5 && !result.hidden && result.theme === "dark") break;
      await delay(100);
    }
    if (result.rows !== 5 || result.hidden || result.theme !== "dark") throw new Error(`Electron analytics smoke check failed: ${JSON.stringify(result)}`);
    console.log("Electron sandboxed renderer: module imports, dark theme, and dataset analytics passed.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally {
    if (window && !window.isDestroyed()) window.destroy();
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("hf-access-desk-electron-check-")) await rm(resolved, { recursive: true, force: true }).catch(() => {});
    app.exit(process.exitCode || 0);
  }
})();
