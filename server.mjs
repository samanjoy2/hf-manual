import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");

loadDotEnv(join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 7860);
const HOST = process.env.HOST || "0.0.0.0";
const HF_ENDPOINT = (process.env.HF_ENDPOINT || "https://huggingface.co").replace(/\/$/, "");
const HF_TOKEN = process.env.HF_TOKEN || "";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const EXTRA_DATASETS = (process.env.HF_DATASETS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const CACHE_TTL_MS = Math.max(10_000, Number(process.env.CACHE_TTL_SECONDS || 60) * 1000);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sessions = new Map();
const loginAttempts = new Map();
let overviewCache = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https://huggingface.co; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ...extra,
  };
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, securityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  }));
  res.end(body);
}

function getCookies(req) {
  const result = {};
  for (const pair of (req.headers.cookie || "").split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    result[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return result;
}

function hasValidSession(req) {
  if (!APP_PASSWORD) return true;
  const token = getCookies(req).hf_access_session;
  const expiresAt = token && sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return true;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJsonBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function encodeRepo(repoId) {
  return repoId.split("/").map(encodeURIComponent).join("/");
}

async function hfFetch(path, options = {}) {
  if (!HF_TOKEN) throw new HttpError(503, "HF_TOKEN is not configured on the server.");
  const response = await fetch(`${HF_ENDPOINT}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${HF_TOKEN}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
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
    const error = new HttpError(response.status, message);
    error.hfStatus = response.status;
    throw error;
  }
  return { payload, headers: response.headers };
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
  const orgs = Array.isArray(whoami?.orgs) ? whoami.orgs : [];
  return orgs
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

async function discoverDatasets() {
  const { payload: whoami } = await hfFetch("/api/whoami-v2");
  const username = whoami?.name || whoami?.user || whoami?.username;
  if (!username) throw new HttpError(502, "Could not determine the Hugging Face account for this token.");

  const namespaces = [...new Set([username, ...normalizeOrgs(whoami)])];
  const discovered = [];
  const discoveryErrors = [];

  await mapLimit(namespaces, 4, async (namespace) => {
    const params = new URLSearchParams({ author: namespace, limit: "500", full: "true", gated: "true" });
    try {
      const { payload } = await hfFetch(`/api/datasets?${params}`);
      for (const dataset of Array.isArray(payload) ? payload : []) {
        const id = dataset.id || dataset._id;
        if (!id) continue;
        const gated = dataset.gated;
        if (gated === true || gated === "manual" || gated === "auto") {
          discovered.push({ id, gated, private: Boolean(dataset.private), namespace });
        }
      }
    } catch (error) {
      discoveryErrors.push({ namespace, message: error.message });
    }
  });

  for (const id of EXTRA_DATASETS) {
    if (!discovered.some((dataset) => dataset.id === id)) {
      discovered.push({ id, gated: "configured", private: null, namespace: id.split("/")[0] });
    }
  }

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
  const expanded = raw?.user && typeof raw.user === "object" && !Array.isArray(raw.user)
    ? raw.user
    : {};
  const username = firstText(
    raw?.username,
    typeof raw?.user === "string" ? raw.user : "",
    expanded.username,
    expanded.name,
    expanded.user,
    expanded.handle,
  );
  return {
    username: username || "unknown",
    fullname: firstText(
      raw?.fullname,
      raw?.fullName,
      expanded.fullname,
      expanded.fullName,
      expanded.displayName,
      username,
    ),
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
  for (const key of ["requests", "accessRequests", "items"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

async function getDatasetRequests(dataset) {
  const statuses = ["pending", "accepted", "rejected"];
  const requests = [];
  const errors = [];
  await mapLimit(statuses, 3, async (status) => {
    try {
      const { payload } = await hfFetch(`/api/datasets/${encodeRepo(dataset.id)}/user-access-request/${status}`);
      requests.push(...extractRequestArray(payload).map((item) => normalizeRequest(item, dataset.id, status)));
    } catch (error) {
      errors.push({ status, code: error.hfStatus || error.status || 500, message: error.message });
    }
  });
  return { ...dataset, requests, errors };
}

async function buildOverview(force = false) {
  if (!force && overviewCache && Date.now() - overviewCache.createdAt < CACHE_TTL_MS) {
    return { ...overviewCache.value, cached: true };
  }
  const discovery = await discoverDatasets();
  const datasets = await mapLimit(discovery.datasets, 6, getDatasetRequests);
  const requests = datasets.flatMap((dataset) => dataset.requests);
  const counts = { pending: 0, accepted: 0, rejected: 0 };
  for (const request of requests) {
    if (counts[request.status] !== undefined) counts[request.status]++;
  }
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

async function handleActions(body) {
  const action = String(body.action || "");
  if (!["accepted", "rejected", "pending", "reset"].includes(action)) {
    throw new HttpError(400, "Unsupported request action.");
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 500) throw new HttpError(400, "Choose between 1 and 500 requests.");
  const reason = String(body.reason || "").trim();
  if (reason.length > 200) throw new HttpError(400, "The reason must be 200 characters or fewer.");

  const results = await mapLimit(items, 5, async (item) => {
    const repoId = String(item.repoId || "").trim();
    const username = String(item.username || "").trim();
    if (!repoId.includes("/") || !username) {
      return { repoId, username, ok: false, error: "Invalid dataset or username." };
    }
    const payload = { status: action, user: username };
    if (action === "rejected" && reason) payload.rejectionReason = reason;
    if (action === "reset" && reason) payload.resetReason = reason;
    try {
      await hfFetch(`/api/datasets/${encodeRepo(repoId)}/user-access-request/handle`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return { repoId, username, ok: true };
    } catch (error) {
      return { repoId, username, ok: false, error: error.message, code: error.hfStatus || error.status };
    }
  });
  overviewCache = null;
  return { results, succeeded: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, { ok: true, tokenConfigured: Boolean(HF_TOKEN), passwordConfigured: Boolean(APP_PASSWORD) });
  }
  if (url.pathname === "/api/auth/status" && req.method === "GET") {
    return json(res, 200, { required: Boolean(APP_PASSWORD), authenticated: hasValidSession(req) });
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    if (!APP_PASSWORD) return json(res, 200, { authenticated: true });
    const ip = req.socket.remoteAddress || "unknown";
    const attempts = (loginAttempts.get(ip) || []).filter((time) => Date.now() - time < 10 * 60 * 1000);
    if (attempts.length >= 10) throw new HttpError(429, "Too many login attempts. Try again later.");
    const body = await readJsonBody(req);
    if (!safeEqual(body.password || "", APP_PASSWORD)) {
      attempts.push(Date.now());
      loginAttempts.set(ip, attempts);
      throw new HttpError(401, "Incorrect dashboard password.");
    }
    loginAttempts.delete(ip);
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return json(res, 200, { authenticated: true }, {
      "Set-Cookie": `hf_access_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    });
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const token = getCookies(req).hf_access_session;
    if (token) sessions.delete(token);
    return json(res, 200, { authenticated: false }, {
      "Set-Cookie": "hf_access_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    });
  }
  if (!hasValidSession(req)) throw new HttpError(401, "Sign in to the dashboard first.");
  if (url.pathname === "/api/overview" && req.method === "GET") {
    return json(res, 200, await buildOverview(url.searchParams.get("refresh") === "1"));
  }
  if (url.pathname === "/api/requests/action" && req.method === "POST") {
    return json(res, 200, await handleActions(await readJsonBody(req)));
  }
  throw new HttpError(404, "API endpoint not found.");
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const decoded = decodeURIComponent(pathname);
  const resolved = normalize(join(PUBLIC_DIR, decoded));
  if (!resolved.startsWith(PUBLIC_DIR) || !existsSync(resolved)) {
    res.writeHead(404, securityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    return res.end("Not found");
  }
  const statHeaders = securityHeaders({
    "Content-Type": MIME_TYPES[extname(resolved)] || "application/octet-stream",
    "Cache-Control": extname(resolved) === ".html" ? "no-cache" : "public, max-age=3600",
  });
  res.writeHead(200, statHeaders);
  createReadStream(resolved).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else if (req.method === "GET" || req.method === "HEAD") serveStatic(req, res, url);
    else throw new HttpError(405, "Method not allowed.");
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    json(res, status, { error: error.message || "Unexpected server error.", details: error.details });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [token, expiresAt] of sessions) if (expiresAt < now) sessions.delete(token);
}, 15 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`HF Access Desk listening on http://${HOST}:${PORT}`);
  if (!HF_TOKEN) console.warn("HF_TOKEN is not configured; the dashboard will show setup instructions.");
  if (!APP_PASSWORD) console.warn("APP_PASSWORD is not configured. Keep this app local or deploy it as a private Space.");
});
