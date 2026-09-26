const { app, BrowserWindow, ipcMain, safeStorage, shell, session } = require("electron");
const { mkdir, readFile, rename, unlink, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const HF_ENDPOINT = "https://huggingface.co";
const CACHE_TTL_MS = 60_000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const INDEX_FILE = path.join(PUBLIC_DIR, "index.html");
const TRUSTED_RENDERER = pathToFileURL(INDEX_FILE).href;

let mainWindow = null;
let overviewCache = null;
let tokenCache = null;

function credentialPath() {
  return path.join(app.getPath("userData"), "credential.json");
}

async function encryptToken(token) {
  if (typeof safeStorage.encryptStringAsync === "function") {
    return safeStorage.encryptStringAsync(token);
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this computer.");
  return safeStorage.encryptString(token);
}

async function decryptToken(buffer) {
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
    tokenCache = await decryptToken(Buffer.from(saved.encrypted, "base64"));
    return tokenCache || null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    console.error("Could not read the saved Hugging Face credential:", error.message);
    return null;
  }
}

async function saveToken(token) {
  const encrypted = await encryptToken(token);
  const file = credentialPath();
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, JSON.stringify({ version: 1, encrypted: encrypted.toString("base64") }), { mode: 0o600 });
  await rename(temporary, file);
  tokenCache = token;
  overviewCache = null;
}

async function forgetToken() {
  tokenCache = null;
  overviewCache = null;
  try { await unlink(credentialPath()); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

function assertTrusted(event) {
  if (event.senderFrame?.url !== TRUSTED_RENDERER) throw new Error("Untrusted IPC sender.");
}

function encodeRepo(repoId) {
  return repoId.split("/").map(encodeURIComponent).join("/");
}

async function hubFetch(apiPath, token, options = {}) {
  const response = await fetch(`${HF_ENDPOINT}${apiPath}`, {
    ...options,
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
  return payload;
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
  overviewCache = { createdAt: Date.now(), value };
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
    if (!/^[^/]+\/[^/]+$/.test(repoId) || !username) return { repoId, username, ok: false, error: "Invalid dataset or username." };
    const payload = { status: action, user: username };
    if (action === "rejected" && reason) payload.rejectionReason = reason;
    if (action === "reset" && reason) payload.resetReason = reason;
    try {
      await hubFetch(`/api/datasets/${encodeRepo(repoId)}/user-access-request/handle`, token, { method: "POST", body: JSON.stringify(payload) });
      return { repoId, username, ok: true };
    } catch (error) {
      return { repoId, username, ok: false, error: error.message, code: error.status };
    }
  });
  overviewCache = null;
  return { results, succeeded: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length };
}

function allowedExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && url.hostname === "huggingface.co" && (url.pathname.startsWith("/datasets/") || url.pathname === "/settings/tokens");
  } catch { return false; }
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
  ipcMain.handle("hub:overview", async (event, force) => { assertTrusted(event); return buildOverview(Boolean(force)); });
  ipcMain.handle("hub:update-requests", async (event, body) => { assertTrusted(event); return updateRequests(body); });
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
    backgroundColor: "#f5f2ea",
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

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerIpc();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
