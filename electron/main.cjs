const { app, BrowserWindow, ipcMain, safeStorage, shell, session, Notification, nativeTheme, dialog } = require("electron");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { mkdir, readFile, rename, stat, unlink, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { allowedExternalUrl } = require("./external-links.cjs");
const { observeRequests } = require("./request-monitor.cjs");
const { UpdateService } = require("./updates.cjs");
const { normalizeDataset, recordSnapshot, importPublisherCsv, nextDatasetPage } = require("./analytics.cjs");

const HF_ENDPOINT = "https://huggingface.co";
const CACHE_TTL_MS = 60_000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const INDEX_FILE = path.join(PUBLIC_DIR, "index.html");
const TRUSTED_RENDERER = pathToFileURL(INDEX_FILE).href;

let mainWindow = null;
let overviewCache = null;
let tokenCache = null;
let credentialGeneration = 0;
let overviewInFlight = null;
let analyticsCache = null;
let analyticsInFlight = null;
let analyticsStorageQueue = Promise.resolve();
let analyticsTrackingEnabled = false;
let settings = { theme: "dark", refreshMinutes: 5, notifications: true, checkUpdates: true, updateNotifications: true };
let notifiedUpdateVersion = "";
let refreshTimer;
let updateTimer;
let updateService;
let requestSnapshot = null;
let snapshotLoaded = false;
const activeNotifications = new Set();

function sendToRenderer(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}

function normalizeSettings(value) {
  return {
    theme: ["dark", "light", "system"].includes(value?.theme) ? value.theme : "dark",
    refreshMinutes: [0, 1, 5, 15, 30].includes(value?.refreshMinutes) ? value.refreshMinutes : 5,
    notifications: typeof value?.notifications === "boolean" ? value.notifications : true,
    checkUpdates: typeof value?.checkUpdates === "boolean" ? value.checkUpdates : true,
    updateNotifications: typeof value?.updateNotifications === "boolean" ? value.updateNotifications : true,
  };
}

async function loadSettings() {
  try { settings = normalizeSettings(JSON.parse(await readFile(path.join(app.getPath("userData"), "settings.json"), "utf8"))); }
  catch { /* First run uses the defaults. */ }
}

function applyNativeTheme() {
  nativeTheme.themeSource = settings.theme;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#11151c" : "#ffffff");
}

function showRequestNotification(count) {
  if (!settings.notifications || !Notification.isSupported()) return;
  const notification = new Notification({
    title: `${count} new dataset access request${count === 1 ? "" : "s"}`,
    body: "Open HF Access Desk to review your pending requests.",
    icon: path.join(PUBLIC_DIR, "app-icon.png"),
  });
  activeNotifications.add(notification);
  notification.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    sendToRenderer("monitor:open-pending", {});
  });
  notification.on("close", () => activeNotifications.delete(notification));
  notification.on("failed", () => activeNotifications.delete(notification));
  notification.show();
}

async function announceUpdate(state) {
  if (state.status !== "available" || !app.isPackaged || !settings.updateNotifications || notifiedUpdateVersion === state.version || !Notification.isSupported()) return;
  notifiedUpdateVersion = state.version;
  const notification = new Notification({ title: "HF Access Desk update available", body: `Version ${state.version} is ready to download. Click to view the update.`, icon: path.join(PUBLIC_DIR, "app-icon.png") });
  activeNotifications.add(notification);
  notification.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
    sendToRenderer("updates:open", {});
  });
  notification.on("close", () => activeNotifications.delete(notification));
  notification.on("failed", () => activeNotifications.delete(notification));
  notification.show();
  const file = path.join(app.getPath("userData"), "update-notice.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify({ version: state.version }));
  await rename(`${file}.tmp`, file);
}

async function observeOverview(overview, generation) {
  if (!snapshotLoaded) {
    try {
      const encrypted = await readFile(path.join(app.getPath("userData"), "request-snapshot.bin"));
      const snapshot = JSON.parse(await decryptText(encrypted));
      if (typeof snapshot.account === "string" && Array.isArray(snapshot.keys)) requestSnapshot = snapshot;
    } catch { /* Establish a baseline without alerting on existing requests. */ }
    snapshotLoaded = true;
  }
  if (generation !== credentialGeneration) return;
  // Do not establish or change the baseline using an incomplete API response.
  if (overview.discoveryErrors.length || overview.datasets.some((dataset) => dataset.errors.length)) return;
  const observed = observeRequests(requestSnapshot, overview);
  requestSnapshot = observed.snapshot;
  const encrypted = await encryptText(JSON.stringify(requestSnapshot));
  if (generation !== credentialGeneration) return;
  const file = path.join(app.getPath("userData"), "request-snapshot.bin");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, encrypted, { mode: 0o600 });
  await rename(`${file}.tmp`, file);
  if (observed.added.length) showRequestNotification(observed.added.length);
}

function scheduleBackgroundWork() {
  clearInterval(refreshTimer);
  clearInterval(updateTimer);
  if (settings.refreshMinutes) {
    refreshTimer = setInterval(async () => {
      try {
        if (!(await loadToken())) return;
        const overview = await getOverview(true);
        sendToRenderer("monitor:overview", overview);
        if (analyticsTrackingEnabled) {
          try { sendToRenderer("analytics:changed", await getAnalytics()); } catch { /* Retain the last analytics view until the next refresh. */ }
        }
      } catch { sendToRenderer("monitor:error", "Automatic refresh failed. The app will retry at the next interval."); }
    }, settings.refreshMinutes * 60_000);
  }
  if (settings.checkUpdates) updateTimer = setInterval(() => updateService.check(), 6 * 60 * 60_000);
}

function getOverview(force = false) {
  if (overviewInFlight) return overviewInFlight;
  overviewInFlight = buildOverview(force).finally(() => { overviewInFlight = null; });
  return overviewInFlight;
}

function credentialPath() {
  return path.join(app.getPath("userData"), "credential.json");
}

function auditLogPath() {
  return path.join(app.getPath("userData"), "audit-log.json");
}

async function encryptText(value) {
  if (typeof safeStorage.encryptStringAsync === "function") {
    return safeStorage.encryptStringAsync(value);
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this computer.");
  return safeStorage.encryptString(value);
}

async function decryptText(buffer) {
  if (typeof safeStorage.decryptStringAsync === "function") {
    const decrypted = await safeStorage.decryptStringAsync(buffer);
    return typeof decrypted === "string" ? decrypted : decrypted.result;
  }
  return safeStorage.decryptString(buffer);
}

async function loadToken() {
  if (tokenCache) return tokenCache;
  try {
    const saved = JSON.parse(await readFile(credentialPath(), "utf8"));
    if (saved.version !== 1 || typeof saved.encrypted !== "string") return null;
    tokenCache = await decryptText(Buffer.from(saved.encrypted, "base64"));
    return tokenCache || null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    console.error("Could not read the saved Hugging Face credential:", error.message);
    return null;
  }
}

async function saveToken(token) {
  const encrypted = await encryptText(token);
  const file = credentialPath();
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, JSON.stringify({ version: 1, encrypted: encrypted.toString("base64") }), { mode: 0o600 });
  await rename(temporary, file);
  tokenCache = token;
  credentialGeneration++;
  overviewCache = null;
  analyticsCache = null;
}

async function forgetToken() {
  credentialGeneration++;
  tokenCache = null;
  overviewCache = null;
  analyticsCache = null;
  analyticsTrackingEnabled = false;
  try { await unlink(credentialPath()); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

function normalizeAuditEntry(entry) {
  const action = String(entry?.action || "");
  if (!["accepted", "rejected", "pending", "reset"].includes(action)) return null;
  const repoId = String(entry?.repoId || "").slice(0, 300);
  const username = String(entry?.username || "").slice(0, 200);
  if (!repoId || !username) return null;
  return {
    id: String(entry?.id || "").slice(0, 200),
    timestamp: String(entry?.timestamp || ""),
    action,
    previousStatus: ["pending", "accepted", "rejected"].includes(entry?.previousStatus) ? entry.previousStatus : "",
    repoId,
    username,
    reason: String(entry?.reason || "").slice(0, 200),
  };
}

async function loadAuditLog() {
  try {
    const saved = JSON.parse(await readFile(auditLogPath(), "utf8"));
    if (saved.version !== 1 || typeof saved.encrypted !== "string") return [];
    const text = await decryptText(Buffer.from(saved.encrypted, "base64"));
    const payload = JSON.parse(text);
    return (Array.isArray(payload.entries) ? payload.entries : []).map(normalizeAuditEntry).filter(Boolean).slice(0, 5000);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    console.error("Could not read the local audit log:", error.message);
    return [];
  }
}

async function saveAuditLog(entries) {
  const encrypted = await encryptText(JSON.stringify({ entries: entries.slice(0, 5000) }));
  const file = auditLogPath();
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, JSON.stringify({ version: 1, encrypted: encrypted.toString("base64") }), { mode: 0o600 });
  await rename(temporary, file);
}

async function appendAuditEntries(entries) {
  if (!entries.length) return;
  const existing = await loadAuditLog();
  await saveAuditLog([...entries, ...existing]);
}

function assertTrusted(event) {
  if (event.senderFrame?.url !== TRUSTED_RENDERER) throw new Error("Untrusted IPC sender.");
}

function encodeRepo(repoId) {
  return repoId.split("/").map(encodeURIComponent).join("/");
}

async function hubFetch(apiPath, token, options = {}) {
  const { withLinks = false, ...fetchOptions } = options;
  const response = await fetch(`${HF_ENDPOINT}${apiPath}`, {
    ...fetchOptions,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload?.error || payload?.message || (typeof payload === "string" ? payload : "") || `Hugging Face returned HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return withLinks ? { payload, link: response.headers.get("link") } : payload;
}

function analyticsFile(account) {
  return path.join(app.getPath("userData"), `analytics-${createHash("sha256").update(account).digest("hex")}.bin`);
}

async function readAnalyticsStore(account) {
  try {
    const store = JSON.parse(await decryptText(await readFile(analyticsFile(account))));
    if (store.version !== 1 || store.account !== account) throw new Error("Invalid analytics storage.");
    return { version: 1, account, history: Array.isArray(store.history) ? store.history : [], publisherHistory: Array.isArray(store.publisherHistory) ? store.publisherHistory : [] };
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Saved analytics could not be read. Your existing history has been preserved.");
    return { version: 1, account, history: [], publisherHistory: [] };
  }
}

async function writeAnalyticsStore(store) {
  const file = analyticsFile(store.account);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, await encryptText(JSON.stringify(store)), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

function analyticsStorage(task) {
  const operation = analyticsStorageQueue.then(task);
  analyticsStorageQueue = operation.catch(() => {});
  return operation;
}

function getAnalytics(force = false) {
  if (analyticsInFlight) return analyticsInFlight;
  if (!force && analyticsCache && Date.now() - analyticsCache.createdAt < 15 * 60_000) return Promise.resolve(analyticsCache.value);
  analyticsInFlight = buildAnalytics().finally(() => { analyticsInFlight = null; });
  return analyticsInFlight;
}

async function buildAnalytics() {
  const generation = credentialGeneration;
  const token = await loadToken();
  if (!token) throw new Error("No Hugging Face token is saved.");
  const { whoami, username } = await identifyAccount(token);
  const namespaces = [...new Set([username, ...normalizeOrgs(whoami)])];
  const datasets = new Map();
  const errors = [];
  const fields = ["downloads", "downloadsAllTime", "likes", "createdAt", "lastModified", "gated", "private", "tags"];
  await mapLimit(namespaces, 3, async (namespace) => {
    const params = new URLSearchParams({ author: namespace, limit: "100" });
    for (const field of fields) params.append("expand", field);
    let next = `/api/datasets?${params}`;
    let pages = 0;
    try {
      while (next && pages++ < 100) {
        const { payload, link } = await hubFetch(next, token, { withLinks: true });
        if (!Array.isArray(payload)) throw new Error("Unexpected dataset metadata response.");
        for (const raw of payload) {
          const normalized = normalizeDataset(raw);
          if (normalized) datasets.set(normalized.id, normalized);
        }
        next = nextDatasetPage(link, namespace);
      }
      if (next) errors.push({ namespace, message: "The dataset catalog exceeded the pagination limit; this namespace is incomplete." });
    } catch (error) { errors.push({ namespace, message: error.message }); }
  });
  if (generation !== credentialGeneration) throw new Error("The connected account changed. Refresh analytics again.");
  const fetchedAt = new Date().toISOString();
  const list = [...datasets.values()].sort((a, b) => a.id.localeCompare(b.id));
  // The catalog endpoint rejects usedStorage; it is available on dataset details.
  await mapLimit(list, 4, async (dataset) => {
    try {
      const detail = await hubFetch(`/api/datasets/${encodeRepo(dataset.id)}?expand=usedStorage`, token);
      dataset.usedStorage = Number.isSafeInteger(detail?.usedStorage) && detail.usedStorage >= 0 ? detail.usedStorage : null;
    } catch (error) { errors.push({ namespace: dataset.id, message: `Storage unavailable: ${error.message}` }); }
  });
  let history = [], publisherHistory = [];
  await analyticsStorage(async () => {
    try {
      const store = await readAnalyticsStore(username);
      store.history = recordSnapshot(store.history, list, fetchedAt);
      history = store.history;
      publisherHistory = store.publisherHistory;
      if (generation !== credentialGeneration) throw new Error("The connected account changed.");
      await writeAnalyticsStore(store);
    } catch (error) { errors.push({ namespace: "Local history", message: error.message }); }
  });
  if (generation !== credentialGeneration) throw new Error("The connected account changed. Refresh analytics again.");
  const value = { account: username, namespaces, datasets: list, history, publisherHistory, fetchedAt, errors };
  analyticsCache = { createdAt: Date.now(), value };
  analyticsTrackingEnabled = true;
  return value;
}

async function importAnalyticsHistory() {
  const generation = credentialGeneration;
  const analytics = await getAnalytics();
  const selected = await dialog.showOpenDialog(mainWindow, { title: "Import Hugging Face publisher history", properties: ["openFile"], filters: [{ name: "Hugging Face analytics CSV", extensions: ["csv"] }] });
  if (selected.canceled || !selected.filePaths.length) return { canceled: true };
  const file = selected.filePaths[0];
  if ((await stat(file)).size > 20 * 1024 * 1024) throw new Error("Choose a CSV smaller than 20 MB.");
  const csv = await readFile(file, "utf8");
  return analyticsStorage(async () => {
    if (generation !== credentialGeneration) throw new Error("The connected account changed. Import history again.");
    const store = await readAnalyticsStore(analytics.account);
    const result = importPublisherCsv(csv, analytics.datasets.map((dataset) => dataset.id), store.publisherHistory);
    store.publisherHistory = result.rows;
    await writeAnalyticsStore(store);
    if (generation !== credentialGeneration) throw new Error("The connected account changed. Import history again.");
    const data = { ...analytics, publisherHistory: result.rows };
    analyticsCache = { createdAt: Date.now(), value: data };
    return { canceled: false, imported: result.imported, data };
  });
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function normalizeOrgs(whoami) {
  return (Array.isArray(whoami?.orgs) ? whoami.orgs : [])
    .filter((org) => {
      const role = String(org.roleInOrg || org.role || "").toLowerCase();
      return !role || ["admin", "write", "contributor"].includes(role);
    })
    .map((org) => org.name || org.displayName)
    .filter(Boolean);
}

function absoluteHubUrl(value) {
  if (!value) return null;
  try { return new URL(value, HF_ENDPOINT).toString(); } catch { return null; }
}

async function identifyAccount(token) {
  const whoami = await hubFetch("/api/whoami-v2", token);
  const username = whoami?.name || whoami?.user || whoami?.username;
  if (!username) throw new Error("This token did not return a Hugging Face account.");
  return { whoami, username };
}

async function discoverDatasets(token) {
  const { whoami, username } = await identifyAccount(token);
  const namespaces = [...new Set([username, ...normalizeOrgs(whoami)])];
  const discovered = [];
  const discoveryErrors = [];

  await mapLimit(namespaces, 4, async (namespace) => {
    const params = new URLSearchParams({ author: namespace, limit: "500", full: "true", gated: "true" });
    try {
      const payload = await hubFetch(`/api/datasets?${params}`, token);
      for (const dataset of Array.isArray(payload) ? payload : []) {
        const id = dataset.id || dataset._id;
        const gated = dataset.gated;
        if (id && (gated === true || gated === "manual" || gated === "auto")) {
          discovered.push({ id, gated, private: Boolean(dataset.private), namespace });
        }
      }
    } catch (error) {
      discoveryErrors.push({ namespace, message: error.message });
    }
  });

  return {
    account: { username, avatarUrl: absoluteHubUrl(whoami?.avatarUrl) },
    namespaces,
    datasets: discovered.sort((a, b) => a.id.localeCompare(b.id)),
    discoveryErrors,
  };
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function requestUser(raw) {
  const expanded = raw?.user && typeof raw.user === "object" && !Array.isArray(raw.user) ? raw.user : {};
  const username = firstText(raw?.username, typeof raw?.user === "string" ? raw.user : "", expanded.username, expanded.name, expanded.user, expanded.handle);
  return {
    username: username || "unknown",
    fullname: firstText(raw?.fullname, raw?.fullName, expanded.fullname, expanded.fullName, expanded.displayName, username),
    email: firstText(raw?.email, expanded.email),
  };
}

function normalizeRequest(raw, repoId, status) {
  const user = requestUser(raw);
  return {
    id: `${repoId}::${user.username}::${status}`,
    repoId,
    username: user.username,
    fullname: user.fullname,
    email: user.email,
    status: raw.status || status,
    requestedAt: raw.time || raw.timestamp || raw.requestedAt || null,
    reviewedAt: raw.reviewedAt || raw.reviewed_at || null,
    fields: raw.fields || raw.extraFields || null,
  };
}

function extractRequestArray(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["requests", "accessRequests", "items"]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

async function getDatasetRequests(dataset, token) {
  const requests = [];
  const errors = [];
  await mapLimit(["pending", "accepted", "rejected"], 3, async (status) => {
    try {
      const payload = await hubFetch(`/api/datasets/${encodeRepo(dataset.id)}/user-access-request/${status}`, token);
      requests.push(...extractRequestArray(payload).map((item) => normalizeRequest(item, dataset.id, status)));
    } catch (error) {
      errors.push({ status, code: error.status || 500, message: error.message });
    }
  });
  return { ...dataset, requests, errors };
}

async function buildOverview(force = false) {
  const generation = credentialGeneration;
  const token = await loadToken();
  if (!token) throw new Error("No Hugging Face token is saved.");
  if (!force && overviewCache && Date.now() - overviewCache.createdAt < CACHE_TTL_MS) return { ...overviewCache.value, cached: true };
  const discovery = await discoverDatasets(token);
  const datasets = await mapLimit(discovery.datasets, 6, (dataset) => getDatasetRequests(dataset, token));
  const requests = datasets.flatMap((dataset) => dataset.requests);
  const counts = { pending: 0, accepted: 0, rejected: 0 };
  for (const request of requests) if (counts[request.status] !== undefined) counts[request.status]++;
  const value = {
    account: discovery.account,
    namespaces: discovery.namespaces,
    datasets: datasets.map(({ requests: ignored, ...dataset }) => dataset),
    requests: requests.sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0)),
    counts,
    discoveryErrors: discovery.discoveryErrors,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
  if (generation !== credentialGeneration) throw new Error("The saved token changed. Refresh to load the new account.");
  overviewCache = { createdAt: Date.now(), value };
  try { await observeOverview(value, generation); } catch { /* A snapshot failure must not block the review queue. */ }
  return value;
}

async function updateRequests(body) {
  const token = await loadToken();
  if (!token) throw new Error("No Hugging Face token is saved.");
  const action = String(body?.action || "");
  if (!["accepted", "rejected", "pending", "reset"].includes(action)) throw new Error("Unsupported request action.");
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length || items.length > 500) throw new Error("Choose between 1 and 500 requests.");
  const reason = String(body?.reason || "").trim();
  if (reason.length > 200) throw new Error("The reason must be 200 characters or fewer.");

  const results = await mapLimit(items, 5, async (item) => {
    const repoId = String(item.repoId || "").trim();
    const username = String(item.username || "").trim();
    const previousStatus = ["pending", "accepted", "rejected"].includes(item.status) ? item.status : "";
    if (!/^[^/]+\/[^/]+$/.test(repoId) || !username) return { repoId, username, previousStatus, ok: false, error: "Invalid dataset or username." };
    const payload = { status: action, user: username };
    if (action === "rejected" && reason) payload.rejectionReason = reason;
    if (action === "reset" && reason) payload.resetReason = reason;
    try {
      await hubFetch(`/api/datasets/${encodeRepo(repoId)}/user-access-request/handle`, token, { method: "POST", body: JSON.stringify(payload) });
      return { repoId, username, previousStatus, ok: true };
    } catch (error) {
      return { repoId, username, previousStatus, ok: false, error: error.message, code: error.status };
    }
  });
  let auditWarning = "";
  const timestamp = new Date().toISOString();
  const successfulEntries = results.filter((item) => item.ok).map((item, index) => ({
    id: `${Date.now()}-${index}-${item.repoId}-${item.username}`,
    timestamp,
    action,
    previousStatus: item.previousStatus,
    repoId: item.repoId,
    username: item.username,
    reason,
  }));
  try {
    await appendAuditEntries(successfulEntries);
  } catch (error) {
    auditWarning = "The request was updated, but the local audit log could not be saved.";
    console.error("Could not update the local audit log:", error.message);
  }
  overviewCache = null;
  return { results, succeeded: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, auditWarning };
}

function registerIpc() {
  ipcMain.handle("credential:status", async (event) => {
    assertTrusted(event);
    return { hasToken: Boolean(await loadToken()) };
  });
  ipcMain.handle("credential:save", async (event, value) => {
    assertTrusted(event);
    const token = String(value || "").trim();
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(token) || token.length > 512) throw new Error("Enter a valid Hugging Face user access token.");
    const { username } = await identifyAccount(token);
    await saveToken(token);
    return { saved: true, username };
  });
  ipcMain.handle("credential:forget", async (event) => { assertTrusted(event); await forgetToken(); return { forgotten: true }; });
  ipcMain.handle("hub:overview", async (event, force) => { assertTrusted(event); return getOverview(Boolean(force)); });
  ipcMain.handle("hub:update-requests", async (event, body) => { assertTrusted(event); return updateRequests(body); });
  ipcMain.handle("audit:list", async (event) => { assertTrusted(event); return loadAuditLog(); });
  ipcMain.handle("analytics:get", (event, force) => { assertTrusted(event); return getAnalytics(Boolean(force)); });
  ipcMain.handle("analytics:import", (event) => { assertTrusted(event); return importAnalyticsHistory(); });
  ipcMain.handle("settings:get", (event) => { assertTrusted(event); return settings; });
  ipcMain.handle("settings:save", async (event, value) => {
    assertTrusted(event);
    const next = normalizeSettings(value);
    const file = path.join(app.getPath("userData"), "settings.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(next));
    await rename(`${file}.tmp`, file);
    settings = next;
    applyNativeTheme();
    scheduleBackgroundWork();
    return settings;
  });
  ipcMain.handle("updates:status", (event) => { assertTrusted(event); return updateService.state; });
  ipcMain.handle("updates:check", (event) => { assertTrusted(event); return updateService.check(); });
  ipcMain.handle("updates:download", (event) => { assertTrusted(event); return updateService.download(); });
  ipcMain.handle("updates:install", async (event) => {
    assertTrusted(event);
    const installer = await updateService.prepareInstall();
    await new Promise((resolve, reject) => {
      const child = spawn(installer, [], { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(); });
    });
    updateService.setState({ status: "installing", message: "Opening the update installer…" });
    setTimeout(() => app.quit(), 300);
    return true;
  });
  ipcMain.handle("app:open-external", async (event, url) => {
    assertTrusted(event);
    if (!allowedExternalUrl(url)) throw new Error("This link is not allowed.");
    await shell.openExternal(url);
    return true;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#11151c" : "#ffffff",
    title: "HF Access Desk",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.loadFile(INDEX_FILE);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  app.setAppUserModelId("com.samanjoy.hfaccessdesk");
  await loadSettings();
  try { notifiedUpdateVersion = JSON.parse(await readFile(path.join(app.getPath("userData"), "update-notice.json"), "utf8")).version || ""; } catch { /* No update notice has been recorded yet. */ }
  applyNativeTheme();
  nativeTheme.on("updated", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#11151c" : "#ffffff");
  });
  updateService = new UpdateService({
    version: app.getVersion(),
    directory: path.join(app.getPath("userData"), "updates"),
    enabled: app.isPackaged && process.platform === "win32",
    emit: (state) => {
      sendToRenderer("updates:changed", state);
      announceUpdate(state).catch(() => {});
    },
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerIpc();
  createWindow();
  scheduleBackgroundWork();
  if (settings.checkUpdates) updateService.check();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { clearInterval(refreshTimer); clearInterval(updateTimer); });
}
