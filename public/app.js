const state = {
  data: null,
  status: "pending",
  query: "",
  dataset: "all",
  sort: "newest",
  dateRange: "all",
  audit: [],
  selected: new Set(),
  pendingAction: null,
  hasToken: false,
  update: null,
  page: 1,
  pageSize: 25,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const els = {
  appView: $("#appView"), sidebarToggle: $("#sidebarToggle"),
  setupView: $("#setupView"), tokenForm: $("#tokenForm"), tokenInput: $("#tokenInput"), tokenError: $("#tokenError"),
  saveTokenButton: $("#saveTokenButton"), toggleToken: $("#toggleToken"), tokenHelp: $("#tokenHelp"), cancelTokenButton: $("#cancelTokenButton"), forgetTokenButton: $("#forgetTokenButton"),
  dashboardContent: $("#dashboardContent"), setupPanel: $("#setupPanel"), loadingState: $("#loadingState"), emptyState: $("#emptyState"),
  requestRows: $("#requestRows"), searchInput: $("#searchInput"), datasetFilter: $("#datasetFilter"), selectAll: $("#selectAll"),
  bulkBar: $("#bulkBar"), selectedCount: $("#selectedCount"), refreshButton: $("#refreshButton"), exportButton: $("#exportButton"),
  sortSelect: $("#sortSelect"), dateFilter: $("#dateFilter"), clearFiltersButton: $("#clearFiltersButton"), resultCount: $("#resultCount"), auditButton: $("#auditButton"),
  pageTitle: $("#pageTitle"), lastUpdated: $("#lastUpdated"), warningBar: $("#warningBar"), accountMini: $("#accountMini"), changeTokenButton: $("#changeTokenButton"),
  dialog: $("#confirmDialog"), confirmForm: $("#confirmForm"), confirmTitle: $("#confirmTitle"), confirmMessage: $("#confirmMessage"), confirmAction: $("#confirmAction"),
  reasonWrap: $("#reasonWrap"), reasonInput: $("#reasonInput"), reasonCount: $("#reasonCount"), toastRegion: $("#toastRegion"),
  detailsDialog: $("#detailsDialog"), detailsTitle: $("#detailsTitle"), detailsBody: $("#detailsBody"), closeDetailsButton: $("#closeDetailsButton"),
  auditDialog: $("#auditDialog"), auditRows: $("#auditRows"), auditEmpty: $("#auditEmpty"), closeAuditButton: $("#closeAuditButton"), exportAuditCsvButton: $("#exportAuditCsvButton"), exportAuditJsonButton: $("#exportAuditJsonButton"),
  settingsDialog: $("#settingsDialog"), settingsButton: $("#settingsButton"), setupSettingsButton: $("#setupSettingsButton"), closeSettingsButton: $("#closeSettingsButton"), settingsForm: $("#settingsForm"), refreshInterval: $("#refreshInterval"), notificationsToggle: $("#notificationsToggle"), updatesToggle: $("#updatesToggle"), settingsSaved: $("#settingsSaved"),
  checkUpdateButton: $("#checkUpdateButton"), downloadUpdateButton: $("#downloadUpdateButton"), installUpdateButton: $("#installUpdateButton"), installedVersion: $("#installedVersion"), updateStatusText: $("#updateStatusText"), updateProgress: $("#updateProgress"), updateBanner: $("#updateBanner"), updateBannerText: $("#updateBannerText"), updateBannerButton: $("#updateBannerButton"),
  queueCount: $("#queueCount"), pageDescription: $("#pageDescription"), emptyTitle: $("#emptyTitle"), emptyDescription: $("#emptyDescription"), pageSizeSelect: $("#pageSizeSelect"), pageInfo: $("#pageInfo"), previousPageButton: $("#previousPageButton"), nextPageButton: $("#nextPageButton"), detailsActions: $("#detailsActions"),
};

const ICON_PATHS = {
  accepted: '<path d="m5 12 4 4L19 6"/>',
  rejected: '<path d="m6 6 12 12M18 6 6 18"/>',
  pending: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  details: '<path d="m9 5 7 7-7 7"/>',
  dataset: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.details}</svg>`;
}

function statusPill(status) {
  return `<span class="status-pill status-${escapeHtml(status)}">${icon(status)}${escapeHtml(status)}</span>`;
}

function currentPageRequests() {
  const requests = visibleRequests();
  return requests.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
}

function setSidebarCollapsed(collapsed, persist = true) {
  els.appView.classList.toggle("sidebar-collapsed", collapsed);
  els.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  els.sidebarToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  els.sidebarToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  if (persist) {
    try { localStorage.setItem("hf-access-desk:sidebar-collapsed", String(collapsed)); } catch { /* Preference persistence is optional. */ }
  }
}

let sidebarStartsCollapsed = false;
try { sidebarStartsCollapsed = localStorage.getItem("hf-access-desk:sidebar-collapsed") === "true"; } catch { /* Use the expanded default. */ }
setSidebarCollapsed(sidebarStartsCollapsed, false);

function friendlyError(error) {
  return String(error?.message || error || "Something went wrong.")
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, "")
    .replace(/^Error:\s*/, "");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function showSetup(canCancel = false) {
  els.appView.classList.add("hidden");
  els.setupView.classList.remove("hidden");
  els.cancelTokenButton.classList.toggle("hidden", !canCancel);
  els.forgetTokenButton.classList.toggle("hidden", !state.hasToken);
  els.tokenInput.value = "";
  els.tokenInput.type = "password";
  els.toggleToken.textContent = "Show";
  els.tokenError.textContent = "";
  setTimeout(() => els.tokenInput.focus(), 0);
}

function showApp() {
  els.setupView.classList.add("hidden");
  els.appView.classList.remove("hidden");
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : ""}`;
  node.textContent = message;
  els.toastRegion.append(node);
  setTimeout(() => node.remove(), 4200);
}

function initials(name) {
  return String(name || "?").split(/[\s_-]+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function formatDate(value) {
  if (!value) return { date: "—", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: String(value), time: "" };
  return {
    date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date),
    time: new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date),
  };
}

function visibleRequests() {
  if (!state.data) return [];
  const query = state.query.trim().toLowerCase();
  const cutoff = state.dateRange === "all" ? 0 : Date.now() - Number(state.dateRange) * 86_400_000;
  const requests = state.data.requests.filter((request) => {
    if (state.status !== "all" && request.status !== state.status) return false;
    if (state.dataset !== "all" && request.repoId !== state.dataset) return false;
    if (cutoff) {
      const requestedAt = new Date(request.requestedAt || 0).getTime();
      if (!Number.isFinite(requestedAt) || requestedAt < cutoff) return false;
    }
    if (!query) return true;
    return [request.username, request.fullname, request.email, request.repoId].some((value) => String(value || "").toLowerCase().includes(query));
  });
  const text = (value) => String(value || "").toLocaleLowerCase();
  const date = (value) => new Date(value || 0).getTime() || 0;
  const statusOrder = { pending: 0, accepted: 1, rejected: 2 };
  const comparators = {
    newest: (a, b) => date(b.requestedAt) - date(a.requestedAt),
    oldest: (a, b) => date(a.requestedAt) - date(b.requestedAt),
    requester: (a, b) => text(a.fullname || a.username).localeCompare(text(b.fullname || b.username)),
    dataset: (a, b) => text(a.repoId).localeCompare(text(b.repoId)),
    status: (a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || date(b.requestedAt) - date(a.requestedAt),
  };
  return requests.sort(comparators[state.sort] || comparators.newest);
}

function actionButtons(request) {
  const data = `data-id="${escapeHtml(request.id)}"`;
  if (request.status === "pending") return `<button class="row-button danger" data-action="rejected" ${data}>Reject</button><button class="row-button approve" data-action="accepted" ${data}>${icon("accepted")}Approve</button>`;
  if (request.status === "accepted") return `<button class="row-button" data-action="pending" ${data}>${icon("pending")}Pending</button><button class="row-button danger" data-action="rejected" ${data}>Revoke</button>`;
  return `<button class="row-button" data-action="reset" ${data}>${icon("reset")}Reset</button><button class="row-button approve" data-action="accepted" ${data}>${icon("accepted")}Approve</button>`;
}

function datasetUrl(repoId) {
  return `https://huggingface.co/datasets/${String(repoId).split("/").map(encodeURIComponent).join("/")}`;
}

function profileUrl(username) {
  return `https://huggingface.co/${encodeURIComponent(String(username))}`;
}

function emailSearchUrl(email) {
  return `https://www.google.com/search?q=${encodeURIComponent(String(email))}`;
}

function renderTable() {
  const filtered = visibleRequests();
  const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const requests = currentPageRequests();
  els.requestRows.innerHTML = requests.map((request) => {
    const requested = formatDate(request.requestedAt);
    const [namespace, ...name] = String(request.repoId).split("/");
    return `<tr class="${state.selected.has(request.id) ? "selected" : ""}">
      <td class="check-cell"><input class="row-check" type="checkbox" aria-label="Select ${escapeHtml(request.username)}" data-id="${escapeHtml(request.id)}" ${state.selected.has(request.id) ? "checked" : ""}></td>
      <td><div class="person"><span class="initial">${escapeHtml(initials(request.fullname || request.username))}</span><div><strong><button class="requester-name" type="button" data-details="${escapeHtml(request.id)}" title="View request details">${escapeHtml(request.fullname || request.username)}</button></strong><span class="person-meta"><a class="person-link" data-external href="${escapeHtml(profileUrl(request.username))}" title="Open @${escapeHtml(request.username)} on Hugging Face">@${escapeHtml(request.username)}</a>${request.email ? ` · <a class="person-link email-link" data-external href="${escapeHtml(emailSearchUrl(request.email))}" title="Search this email with Google">${escapeHtml(request.email)}</a>` : ""}</span></div></div></td>
      <td><a class="repo-link dataset-cell" data-external href="${escapeHtml(datasetUrl(request.repoId))}" title="${escapeHtml(request.repoId)}">${icon("dataset")}<span class="dataset-copy"><strong>${escapeHtml(name.join("/"))}</strong><small>${escapeHtml(namespace)}</small></span></a></td>
      <td><span class="date-primary">${escapeHtml(requested.date)}</span><span class="date-secondary">${escapeHtml(requested.time)}</span></td>
      <td>${statusPill(request.status)}</td>
      <td><div class="row-actions">${actionButtons(request)}<button class="row-button details-button" type="button" data-details="${escapeHtml(request.id)}" title="View request details" aria-label="View details for ${escapeHtml(request.fullname || request.username)}">${icon("details")}</button></div></td>
    </tr>`;
  }).join("");
  els.emptyState.classList.toggle("hidden", requests.length > 0);
  els.loadingState.classList.add("hidden");
  const visibleIds = requests.map((request) => request.id);
  els.selectAll.checked = Boolean(visibleIds.length) && visibleIds.every((id) => state.selected.has(id));
  els.selectAll.indeterminate = visibleIds.some((id) => state.selected.has(id)) && !els.selectAll.checked;
  els.selectAll.setAttribute("aria-label", "Select all requests on this page");
  els.queueCount.textContent = filtered.length;
  const first = filtered.length ? (state.page - 1) * state.pageSize + 1 : 0;
  const last = Math.min(state.page * state.pageSize, filtered.length);
  els.resultCount.textContent = filtered.length ? `Showing ${first}–${last} of ${filtered.length} requests` : "0 requests";
  els.pageInfo.textContent = `${state.page} of ${pages}`;
  els.previousPageButton.disabled = state.page === 1;
  els.nextPageButton.disabled = state.page === pages;
  const hasFilters = state.query.trim() || state.dataset !== "all" || state.dateRange !== "all";
  els.emptyTitle.textContent = hasFilters ? "No matching requests" : state.status === "pending" ? "You're all caught up" : "No requests yet";
  els.emptyDescription.textContent = hasFilters ? "Try a different search or clear your filters." : state.status === "pending" ? "New access requests will appear here when they arrive." : `There are no ${state.status === "all" ? "dataset access" : state.status} requests in this workspace.`;
  renderBulkBar();
}

function renderBulkBar() {
  els.bulkBar.classList.toggle("hidden", state.selected.size === 0);
  els.selectedCount.textContent = state.selected.size;
}

function renderOverview() {
  const { data } = state;
  const currentIds = new Set(data.requests.map((request) => request.id));
  state.selected = new Set([...state.selected].filter((id) => currentIds.has(id)));
  $("#statPending").textContent = data.counts.pending;
  $("#statDatasets").textContent = data.datasets.length;
  $("#statAccepted").textContent = data.counts.accepted;
  $("#navPending").textContent = data.counts.pending;
  $("#navAccepted").textContent = data.counts.accepted;
  $("#navRejected").textContent = data.counts.rejected;
  $("#navAll").textContent = data.requests.length;
  els.lastUpdated.textContent = `${data.cached ? "Cached" : "Updated"} ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(data.fetchedAt))}`;
  const issueCount = data.datasets.reduce((sum, dataset) => sum + dataset.errors.length, 0) + data.discoveryErrors.length;
  $("#datasetHealth").textContent = issueCount ? `${issueCount} sync issue${issueCount === 1 ? "" : "s"}` : "All datasets synced";
  els.warningBar.classList.toggle("hidden", issueCount === 0);
  if (issueCount) els.warningBar.textContent = `Some data could not be loaded (${issueCount} API ${issueCount === 1 ? "error" : "errors"}). Check that the token has write access to each listed dataset.`;
  const account = data.account;
  els.accountMini.innerHTML = `${account.avatarUrl ? `<img class="avatar" src="${escapeHtml(account.avatarUrl)}" alt="">` : `<span class="avatar avatar-fallback">${escapeHtml(initials(account.username))}</span>`}<div class="account-copy"><strong>${escapeHtml(account.username)}</strong><span>${data.namespaces.length} namespace${data.namespaces.length === 1 ? "" : "s"}</span></div>`;
  const avatarImage = els.accountMini.querySelector("img.avatar");
  avatarImage?.addEventListener("error", () => {
    const fallback = document.createElement("span");
    fallback.className = "avatar avatar-fallback";
    fallback.textContent = initials(account.username);
    avatarImage.replaceWith(fallback);
  }, { once: true });
  if (!data.datasets.some((dataset) => dataset.id === state.dataset)) state.dataset = "all";
  els.datasetFilter.innerHTML = `<option value="all">All datasets</option>${data.datasets.map((dataset) => `<option value="${escapeHtml(dataset.id)}">${escapeHtml(dataset.id)}</option>`).join("")}`;
  els.datasetFilter.value = state.dataset;
  els.dashboardContent.classList.remove("hidden");
  els.setupPanel.classList.add("hidden");
  renderTable();
}

async function loadOverview(force = false) {
  els.refreshButton.disabled = true;
  els.refreshButton.classList.add("spinning");
  els.loadingState.classList.remove("hidden");
  try {
    const [overview, audit] = await Promise.all([window.hfDesk.getOverview(force), window.hfDesk.getAuditLog()]);
    state.data = overview;
    state.audit = audit;
    renderOverview();
  } catch (error) {
    const message = friendlyError(error);
    els.loadingState.classList.add("hidden");
    toast(message, "error");
    if (/No Hugging Face token/.test(message)) { state.hasToken = false; showSetup(false); }
  } finally {
    els.refreshButton.disabled = false;
    els.refreshButton.classList.remove("spinning");
  }
}

function findRequests(ids) {
  return state.data.requests.filter((request) => ids.includes(request.id));
}

function openConfirm(action, requests) {
  const labels = { accepted: "Approve", rejected: requests.some((request) => request.status === "accepted") ? "Revoke" : "Reject", pending: "Move", reset: "Reset" };
  const label = labels[action];
  state.pendingAction = { action, requests };
  els.confirmTitle.textContent = `${label} ${requests.length === 1 ? "this request" : `${requests.length} requests`}?`;
  els.confirmMessage.textContent = action === "rejected" ? "The selected users will not be able to access the corresponding datasets." : action === "accepted" ? "The selected users will receive access to the corresponding datasets." : action === "reset" ? "Users will need to agree to the terms and submit a new request." : "The selected requests will return to the pending queue.";
  els.reasonWrap.classList.toggle("hidden", !["rejected", "reset"].includes(action));
  els.reasonInput.value = "";
  els.reasonCount.textContent = "0";
  els.confirmAction.textContent = label;
  els.confirmAction.classList.toggle("primary", action !== "rejected");
  els.confirmAction.classList.toggle("secondary", action === "rejected");
  els.dialog.showModal();
}

async function performAction() {
  const pending = state.pendingAction;
  if (!pending) return;
  els.confirmAction.disabled = true;
  try {
    const result = await window.hfDesk.updateRequests({
      action: pending.action,
      items: pending.requests.map(({ repoId, username, status }) => ({ repoId, username, status })),
      reason: els.reasonInput.value.trim(),
    });
    els.dialog.close();
    state.selected.clear();
    toast(result.failed ? `${result.succeeded} succeeded; ${result.failed} failed.` : `${result.succeeded} request${result.succeeded === 1 ? "" : "s"} updated.`, result.failed ? "error" : "success");
    await loadOverview(true);
    if (result.auditWarning) toast(result.auditWarning, "error");
  } catch (error) {
    toast(friendlyError(error), "error");
  } finally {
    els.confirmAction.disabled = false;
    state.pendingAction = null;
  }
}

function exportCsv() {
  const columns = ["status", "dataset", "username", "full name", "email", "requested at", "reviewed at", "custom fields"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [columns, ...visibleRequests().map((request) => [request.status, request.repoId, request.username, request.fullname, request.email, request.requestedAt, request.reviewedAt, request.fields ? JSON.stringify(request.fields) : ""])].map((row) => row.map(quote).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `hf-access-requests-${state.status}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadText(filename, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function fullDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function fieldEntries(fields) {
  if (!fields) return [];
  if (Array.isArray(fields)) return fields.map((item, index) => {
    if (item && typeof item === "object") return [item.label || item.name || item.question || `Field ${index + 1}`, item.value ?? item.answer ?? item.response ?? item];
    return [`Field ${index + 1}`, item];
  });
  if (typeof fields === "object") return Object.entries(fields);
  return [["Response", fields]];
}

function printableValue(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value == null || value === "") return "—";
  if (typeof value === "object") {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
}

function fieldLabel(label) {
  const text = String(label).replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function auditActionLabel(entry) {
  if (entry.action === "accepted") return "Approved";
  if (entry.action === "rejected") return entry.previousStatus === "accepted" ? "Revoked" : "Rejected";
  if (entry.action === "pending") return "Moved to pending";
  return "Reset request";
}

function openRequestDetails(request) {
  const remoteHistory = state.data.requests
    .filter((item) => String(item.username).toLowerCase() === String(request.username).toLowerCase())
    .sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));
  const localHistory = state.audit.filter((entry) => String(entry.username).toLowerCase() === String(request.username).toLowerCase());
  const fields = fieldEntries(request.fields);
  els.detailsTitle.textContent = request.fullname || request.username;
  els.detailsBody.innerHTML = `
    <div class="details-identity">
      <span class="initial large-initial">${escapeHtml(initials(request.fullname || request.username))}</span>
      <div><a data-external href="${escapeHtml(profileUrl(request.username))}">@${escapeHtml(request.username)}</a>${request.email ? `<a data-external href="${escapeHtml(emailSearchUrl(request.email))}">${escapeHtml(request.email)}</a>` : ""}</div>
      ${statusPill(request.status)}
    </div>
    <section class="detail-section"><h3>Request</h3><dl class="detail-grid">
      <div><dt>Dataset</dt><dd><a data-external href="${escapeHtml(datasetUrl(request.repoId))}">${escapeHtml(request.repoId)}</a></dd></div>
      <div><dt>Requested</dt><dd>${escapeHtml(fullDate(request.requestedAt))}</dd></div>
      <div><dt>Reviewed</dt><dd>${escapeHtml(fullDate(request.reviewedAt))}</dd></div>
    </dl></section>
    <section class="detail-section"><h3>Submitted answers</h3>${fields.length ? `<dl class="field-list">${fields.map(([label, value]) => `<div><dt>${escapeHtml(fieldLabel(label))}</dt><dd>${escapeHtml(printableValue(value))}</dd></div>`).join("")}</dl>` : `<p class="muted">No additional form answers were returned for this request.</p>`}</section>
    <section class="detail-section"><h3>Requests across datasets <span>${remoteHistory.length}</span></h3><div class="history-list">${remoteHistory.map((item) => `<article><div><strong>${escapeHtml(item.repoId)}</strong><small>${escapeHtml(fullDate(item.requestedAt))}</small></div>${statusPill(item.status)}</article>`).join("")}</div></section>
    <section class="detail-section"><h3>Local decision history <span>${localHistory.length}</span></h3>${localHistory.length ? `<div class="history-list">${localHistory.map((entry) => `<article><div><strong>${escapeHtml(auditActionLabel(entry))} · ${escapeHtml(entry.repoId)}</strong><small>${escapeHtml(fullDate(entry.timestamp))}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ""}</small></div></article>`).join("")}</div>` : `<p class="muted">No local decisions recorded for this requester yet.</p>`}</section>`;
  els.detailsActions.innerHTML = actionButtons(request);
  els.detailsDialog.showModal();
}

function renderAuditLog() {
  els.auditRows.innerHTML = state.audit.map((entry) => `<tr>
    <td><span class="date-primary">${escapeHtml(formatDate(entry.timestamp).date)}</span><span class="date-secondary">${escapeHtml(formatDate(entry.timestamp).time)}</span></td>
    <td><a class="person-link" data-external href="${escapeHtml(profileUrl(entry.username))}">@${escapeHtml(entry.username)}</a></td>
    <td><a class="repo-link" data-external href="${escapeHtml(datasetUrl(entry.repoId))}">${escapeHtml(entry.repoId)}</a></td>
    <td><strong>${escapeHtml(auditActionLabel(entry))}</strong></td>
    <td>${escapeHtml(entry.reason || "—")}</td>
  </tr>`).join("");
  els.auditEmpty.classList.toggle("hidden", state.audit.length > 0);
}

function exportAuditCsv() {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [["timestamp", "requester", "dataset", "decision", "previous status", "reason"], ...state.audit.map((entry) => [entry.timestamp, entry.username, entry.repoId, auditActionLabel(entry), entry.previousStatus, entry.reason])];
  downloadText(`hf-access-audit-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((row) => row.map(quote).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}

function exportAuditJson() {
  downloadText(`hf-access-audit-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), entries: state.audit }, null, 2), "application/json;charset=utf-8");
}

els.tokenForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.tokenError.textContent = "";
  els.saveTokenButton.disabled = true;
  els.saveTokenButton.textContent = "Validating token…";
  try {
    const result = await window.hfDesk.saveCredential(els.tokenInput.value);
    state.hasToken = true;
    els.tokenInput.value = "";
    showApp();
    toast(`Connected as ${result.username}.`);
    await loadOverview(true);
  } catch (error) {
    els.tokenError.textContent = friendlyError(error);
  } finally {
    els.saveTokenButton.disabled = false;
    els.saveTokenButton.textContent = "Connect and save token";
  }
});

els.toggleToken.addEventListener("click", () => {
  const showing = els.tokenInput.type === "text";
  els.tokenInput.type = showing ? "password" : "text";
  els.toggleToken.textContent = showing ? "Show" : "Hide";
  els.toggleToken.setAttribute("aria-label", showing ? "Show token" : "Hide token");
});
els.tokenHelp.addEventListener("click", () => window.hfDesk.openExternal("https://huggingface.co/settings/tokens"));
els.changeTokenButton.addEventListener("click", () => showSetup(true));
els.cancelTokenButton.addEventListener("click", () => { if (state.hasToken) showApp(); });
els.forgetTokenButton.addEventListener("click", async () => {
  if (!window.confirm("Forget the saved Hugging Face token on this computer?")) return;
  try {
    await window.hfDesk.forgetCredential();
    state.hasToken = false;
    state.data = null;
    showSetup(false);
  } catch (error) { els.tokenError.textContent = friendlyError(error); }
});

els.refreshButton.addEventListener("click", () => loadOverview(true));
els.sidebarToggle.addEventListener("click", () => setSidebarCollapsed(!els.appView.classList.contains("sidebar-collapsed")));
els.exportButton.addEventListener("click", exportCsv);
els.searchInput.addEventListener("input", () => { state.query = els.searchInput.value; state.page = 1; state.selected.clear(); renderTable(); });
els.datasetFilter.addEventListener("change", () => { state.dataset = els.datasetFilter.value; state.page = 1; state.selected.clear(); renderTable(); });
els.sortSelect.addEventListener("change", () => { state.sort = els.sortSelect.value; state.page = 1; renderTable(); });
els.dateFilter.addEventListener("change", () => { state.dateRange = els.dateFilter.value; state.page = 1; state.selected.clear(); renderTable(); });
els.clearFiltersButton.addEventListener("click", () => {
  state.query = "";
  state.dataset = "all";
  state.sort = "newest";
  state.dateRange = "all";
  state.page = 1;
  els.searchInput.value = "";
  els.datasetFilter.value = "all";
  els.sortSelect.value = "newest";
  els.dateFilter.value = "all";
  state.selected.clear();
  renderTable();
});
els.auditButton.addEventListener("click", () => { renderAuditLog(); els.auditDialog.showModal(); });
els.closeAuditButton.addEventListener("click", () => els.auditDialog.close());
els.closeDetailsButton.addEventListener("click", () => els.detailsDialog.close());
els.detailsActions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const request = state.data.requests.find((item) => item.id === button.dataset.id);
  if (!request) return;
  els.detailsDialog.close();
  openConfirm(button.dataset.action, [request]);
});
els.exportAuditCsvButton.addEventListener("click", exportAuditCsv);
els.exportAuditJsonButton.addEventListener("click", exportAuditJson);
els.reasonInput.addEventListener("input", () => { els.reasonCount.textContent = els.reasonInput.value.length; });

$$('.nav-item').forEach((button) => button.addEventListener("click", () => {
  state.status = button.dataset.status;
  state.page = 1;
  state.selected.clear();
  $$('.nav-item').forEach((item) => {
    item.classList.toggle("active", item === button);
    if (item === button) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  els.pageTitle.textContent = { pending: "Pending review", accepted: "Accepted access", rejected: "Rejected requests", all: "All requests" }[state.status];
  els.pageDescription.textContent = {
    pending: "Review and decide who can access your datasets.",
    accepted: "Manage approved access across your datasets.",
    rejected: "Review decisions and reconsider access requests.",
    all: "Every dataset access request in one workspace.",
  }[state.status];
  renderTable();
}));

els.selectAll.addEventListener("change", () => {
  for (const request of currentPageRequests()) if (els.selectAll.checked) state.selected.add(request.id); else state.selected.delete(request.id);
  renderTable();
});

els.requestRows.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".row-check");
  if (!checkbox) return;
  if (checkbox.checked) state.selected.add(checkbox.dataset.id); else state.selected.delete(checkbox.dataset.id);
  renderTable();
});

els.requestRows.addEventListener("click", (event) => {
  if (event.target.closest("a[data-external]")) return;
  const detailsButton = event.target.closest("[data-details]");
  if (detailsButton) {
    const request = state.data.requests.find((item) => item.id === detailsButton.dataset.details);
    if (request) openRequestDetails(request);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const request = state.data.requests.find((item) => item.id === button.dataset.id);
  if (request) openConfirm(button.dataset.action, [request]);
});

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-external]");
  if (!link) return;
  event.preventDefault();
  window.hfDesk.openExternal(link.href).catch((error) => toast(friendlyError(error), "error"));
});

els.bulkBar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-bulk-action]");
  if (button) openConfirm(button.dataset.bulkAction, findRequests([...state.selected]));
});

els.confirmForm.addEventListener("submit", (event) => {
  if (event.submitter?.value !== "confirm") { state.pendingAction = null; return; }
  event.preventDefault();
  performAction();
});

els.pageSizeSelect.addEventListener("change", () => {
  state.pageSize = Number(els.pageSizeSelect.value);
  state.page = 1;
  renderTable();
});
els.previousPageButton.addEventListener("click", () => { state.page = Math.max(1, state.page - 1); renderTable(); });
els.nextPageButton.addEventListener("click", () => { state.page++; renderTable(); });
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || els.appView.classList.contains("hidden")) return;
  const editing = event.target instanceof Element && event.target.matches("input, textarea, [contenteditable=true]");
  if (event.key.toLowerCase() === "k" && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    els.searchInput.focus();
    els.searchInput.select();
  } else if (event.key.toLowerCase() === "b" && !editing && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    setSidebarCollapsed(!els.appView.classList.contains("sidebar-collapsed"));
  }
});

function renderUpdateStatus(update) {
  state.update = update;
  els.installedVersion.textContent = `Installed version ${update.currentVersion}`;
  els.updateStatusText.textContent = update.message;
  const busy = ["checking", "downloading", "installing"].includes(update.status);
  els.checkUpdateButton.disabled = busy;
  els.downloadUpdateButton.classList.toggle("hidden", update.status !== "available" || !update.canInstall);
  els.installUpdateButton.classList.toggle("hidden", update.status !== "downloaded");
  els.updateProgress.classList.toggle("hidden", update.status !== "downloading");
  els.updateProgress.value = update.progress || 0;
  els.updateBanner.classList.toggle("hidden", !["available", "downloading", "downloaded"].includes(update.status));
  els.updateBannerText.textContent = update.message;
}

async function openSettings() {
  try {
    const preferences = await window.hfDesk.getSettings();
    els.refreshInterval.value = String(preferences.refreshMinutes);
    els.notificationsToggle.checked = preferences.notifications;
    els.updatesToggle.checked = preferences.checkUpdates;
    els.settingsSaved.textContent = "";
    renderUpdateStatus(await window.hfDesk.getUpdateStatus());
    els.settingsDialog.showModal();
  } catch (error) { toast(friendlyError(error), "error"); }
}

els.settingsButton.addEventListener("click", openSettings);
els.setupSettingsButton.addEventListener("click", openSettings);
els.updateBannerButton.addEventListener("click", openSettings);
els.closeSettingsButton.addEventListener("click", () => els.settingsDialog.close());
els.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await window.hfDesk.saveSettings({ refreshMinutes: Number(els.refreshInterval.value), notifications: els.notificationsToggle.checked, checkUpdates: els.updatesToggle.checked });
    els.settingsSaved.textContent = "Preferences saved";
  } catch (error) { toast(friendlyError(error), "error"); }
  finally { button.disabled = false; }
});
els.checkUpdateButton.addEventListener("click", async () => {
  try { renderUpdateStatus(await window.hfDesk.checkUpdates()); }
  catch (error) { toast(friendlyError(error), "error"); }
});
els.downloadUpdateButton.addEventListener("click", async () => {
  try { renderUpdateStatus(await window.hfDesk.downloadUpdate()); }
  catch (error) { toast(friendlyError(error), "error"); }
});
els.installUpdateButton.addEventListener("click", async () => {
  els.installUpdateButton.disabled = true;
  try { await window.hfDesk.installUpdate(); }
  catch (error) {
    toast(friendlyError(error), "error");
    renderUpdateStatus(await window.hfDesk.getUpdateStatus());
    els.installUpdateButton.disabled = false;
  }
});

async function start() {
  if (!window.hfDesk) {
    els.tokenError.textContent = "Launch this project with Electron; it no longer runs in a web browser.";
    return showSetup(false);
  }
  try {
    window.hfDesk.onUpdateStatus(renderUpdateStatus);
    window.hfDesk.onOverview((overview) => {
      if (!state.hasToken) return;
      state.data = overview;
      const ids = new Set(overview.requests.map((request) => request.id));
      state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
      renderOverview();
    });
    window.hfDesk.onRefreshError((message) => {
      if (!state.hasToken) return;
      els.lastUpdated.textContent = message;
    });
    window.hfDesk.onOpenPending(() => document.querySelector('.nav-item[data-status="pending"]').click());
    renderUpdateStatus(await window.hfDesk.getUpdateStatus());
    const credential = await window.hfDesk.getCredentialStatus();
    state.hasToken = credential.hasToken;
    if (!state.hasToken) return showSetup(false);
    showApp();
    await loadOverview();
    const demoParams = new URLSearchParams(window.location.search);
    if (demoParams.get("demo") === "dashboard") {
      const status = demoParams.get("status");
      if (["pending", "accepted", "rejected", "all"].includes(status)) document.querySelector(`.nav-item[data-status="${status}"]`).click();
      const requestId = demoParams.get("details");
      const request = requestId && state.data.requests.find((item) => item.id === requestId);
      if (request) openRequestDetails(request);
      if (demoParams.get("audit") === "1") {
        renderAuditLog();
        els.auditDialog.showModal();
      }
      if (demoParams.get("settings") === "1") await openSettings();
    }
  } catch (error) {
    showSetup(false);
    els.tokenError.textContent = friendlyError(error);
  }
}

start();
