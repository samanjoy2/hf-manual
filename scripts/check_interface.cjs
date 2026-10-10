// Exercise the actual renderer in a headless browser using fictional data only.
const { existsSync } = require("node:fs");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { pathToFileURL } = require("node:url");
const os = require("node:os");
const path = require("node:path");

const browser = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!browser) throw new Error("Edge or Chrome is required for interface checks.");
const root = path.resolve(__dirname, "..");
const url = pathToFileURL(path.join(root, "public", "index.html")).href;

async function until(fn, message) {
  for (let i = 0; i < 100; i++) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await delay(100);
  }
  throw new Error(message);
}

async function main() {
  const profile = await mkdtemp(path.join(os.tmpdir(), "hf-access-desk-ui-check-"));
  const child = spawn(browser, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
    "--allow-file-access-from-files", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let socket;
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  try {
    const port = await until(async () => (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0], "Browser did not start.");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
      if (!message.id) return;
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callback.reject(new Error(message.error.message));
      else callback.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const navigate = async (query) => {
      await send("Page.navigate", { url: `${url}?${query}` });
      await until(() => evaluate(`Boolean(document.querySelector('#requestRows')?.children.length && !document.querySelector('#appView').classList.contains('hidden'))`), "Dashboard did not render.");
    };
    await navigate("demo=dashboard");
    const basics = await evaluate(`(async () => {
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const $ = (selector) => document.querySelector(selector);
      const change = (selector, value) => { $(selector).value = value; $(selector).dispatchEvent(new Event('change', { bubbles: true })); };
      const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
      assert(new Set(ids).size === ids.length, 'Duplicate element IDs');
      assert($('#requestRows').children.length === 4, 'Pending rows');
      $('.nav-item[data-status="accepted"]').click();
      assert($('#requestRows').children.length === 2, 'Accepted navigation');
      assert($('.nav-item[data-status="accepted"]').getAttribute('aria-current') === 'page', 'Accessible current navigation');
      $('.nav-item[data-status="pending"]').click();
      change('#datasetFilter', 'sample-lab/Clinical-Language-Benchmark');
      assert($('#requestRows').children.length === 2, 'Dataset filtering');
      $('#clearFiltersButton').click();
      $('#searchInput').value = 'nonexistent';
      $('#searchInput').dispatchEvent(new Event('input', { bubbles: true }));
      assert(!$('#emptyState').classList.contains('hidden') && $('#emptyTitle').textContent === 'No matching requests', 'Filtered empty state');
      $('#clearFiltersButton').click();
      $('.requester-name').click();
      assert($('#detailsDialog').open && $('#detailsBody').textContent.includes('Example University'), 'Submitted answers in drawer');
      assert($('#detailsActions [data-action="accepted"]'), 'Drawer decision action');
      $('#detailsActions [data-action="accepted"]').click();
      assert(!$('#detailsDialog').open && $('#confirmDialog').open, 'Drawer action confirmation');
      $('#confirmForm button[value="cancel"]').click();
      assert(!$('#confirmDialog').open, 'Cancel confirmation');
      $('#auditButton').click();
      assert($('#auditDialog').open && $('#auditRows').children.length === 2, 'Audit log');
      $('#closeAuditButton').click();
      $('#settingsButton').click();
      await new Promise(resolve => setTimeout(resolve, 50));
      assert($('#settingsDialog').open, 'Settings dialog');
      change('#refreshInterval', '15');
      $('#settingsForm button[type="submit"]').click();
      await new Promise(resolve => setTimeout(resolve, 50));
      assert($('#settingsSaved').textContent === 'Preferences saved', 'Settings persistence');
      $('#closeSettingsButton').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      assert(document.activeElement === $('#searchInput'), 'Search shortcut');
      $('#sidebarToggle').click();
      assert($('#appView').classList.contains('sidebar-collapsed'), 'Sidebar collapse');
      assert(getComputedStyle($('.nav-icon')).display !== 'none', 'Collapsed icons visible');
      return 'Navigation, filters, drawer actions, dialogs, settings, shortcuts, and collapse passed';
    })()`);
    console.log(basics);
    await navigate("demo=dashboard&rows=65");
    const pagination = await evaluate(`(async () => {
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const $ = (selector) => document.querySelector(selector);
      const change = (selector, value) => { $(selector).value = value; $(selector).dispatchEvent(new Event('change', { bubbles: true })); };
      assert($('#requestRows').children.length === 25 && $('#queueCount').textContent === '69', 'Initial pagination');
      change('#pageSizeSelect', '10');
      assert($('#requestRows').children.length === 10 && $('#pageInfo').textContent === '1 of 7', 'Page size');
      $('#selectAll').click();
      assert($('#selectedCount').textContent === '10', 'Select this page only');
      $('#nextPageButton').click();
      assert($('#pageInfo').textContent === '2 of 7' && !$('#selectAll').checked, 'Next page');
      $('#selectAll').click();
      assert($('#selectedCount').textContent === '20', 'Selection preserved across pages');
      $('#searchInput').value = 'Demo Researcher 1';
      $('#searchInput').dispatchEvent(new Event('input', { bubbles: true }));
      assert($('#pageInfo').textContent.startsWith('1 of'), 'Search resets pagination');
      $('#clearFiltersButton').click();
      let exported;
      const originalCreate = URL.createObjectURL;
      const originalClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = (blob) => { exported = blob; return originalCreate(blob); };
      HTMLAnchorElement.prototype.click = () => {};
      $('#exportButton').click();
      URL.createObjectURL = originalCreate;
      HTMLAnchorElement.prototype.click = originalClick;
      assert((await exported.text()).split('\\r\\n').length === 70, 'Export all filtered rows across pages');
      return 'Pagination, page selection, cross-page selection, filter reset, and full CSV export passed';
    })()`);
    console.log(pagination);
    for (const width of [1440, 940, 640]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const collapsed of [true, false]) {
        await evaluate(`{ const app = document.querySelector('#appView'); if (app.classList.contains('sidebar-collapsed') !== ${collapsed}) document.querySelector('#sidebarToggle').click(); }`);
        const layout = await evaluate(`({ width: innerWidth, scroll: document.documentElement.scrollWidth })`);
        if (layout.scroll > layout.width) throw new Error(`Page overflow at ${width}px: ${layout.scroll}px`);
      }
    }
    if (errors.length) throw new Error(errors.join("\n"));
    console.log("Responsive layouts passed at 1440px, 940px, and 640px; no renderer exceptions.");
  } finally {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    const closed = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await Promise.race([closed, delay(3000)]);
    // Only remove the fresh, dedicated browser test profile created above.
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("hf-access-desk-ui-check-")) await rm(resolved, { recursive: true, force: true }).catch(() => {});
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
