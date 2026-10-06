const state = {
  data: null,
  status: "pending",
  query: "",
  dataset: "all",
  selected: new Set(),
  pendingAction: null,
  hasToken: false,
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
  pageTitle: $("#pageTitle"), lastUpdated: $("#lastUpdated"), warningBar: $("#warningBar"), accountMini: $("#accountMini"), changeTokenButton: $("#changeTokenButton"),
  dialog: $("#confirmDialog"), confirmForm: $("#confirmForm"), confirmTitle: $("#confirmTitle"), confirmMessage: $("#confirmMessage"), confirmAction: $("#confirmAction"),
  reasonWrap: $("#reasonWrap"), reasonInput: $("#reasonInput"), reasonCount: $("#reasonCount"), toastRegion: $("#toastRegion"),
};

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
  return state.data.requests.filter((request) => {
    if (state.status !== "all" && request.status !== state.status) return false;
    if (state.dataset !== "all" && request.repoId !== state.dataset) return false;
    if (!query) return true;
    return [request.username, request.fullname, request.email, request.repoId].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function actionButtons(request) {
  const data = `data-id="${escapeHtml(request.id)}"`;
  if (request.status === "pending") return `<button class="row-button danger" data-action="rejected" ${data}>Reject</button><button class="row-button approve" data-action="accepted" ${data}>Approve</button>`;
  if (request.status === "accepted") return `<button class="row-button" data-action="pending" ${data}>Move to pending</button><button class="row-button danger" data-action="rejected" ${data}>Revoke</button>`;
  return `<button class="row-button" data-action="reset" ${data}>Reset request</button><button class="row-button approve" data-action="accepted" ${data}>Approve</button>`;
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
  const requests = visibleRequests();
  els.requestRows.innerHTML = requests.map((request) => {
    const requested = formatDate(request.requestedAt);
    return `<tr>
      <td class="check-cell"><input class="row-check" type="checkbox" aria-label="Select ${escapeHtml(request.username)}" data-id="${escapeHtml(request.id)}" ${state.selected.has(request.id) ? "checked" : ""}></td>
      <td><div class="person"><span class="initial">${escapeHtml(initials(request.fullname || request.username))}</span><div><strong>${escapeHtml(request.fullname || request.username)}</strong><span class="person-meta"><a class="person-link" data-external href="${escapeHtml(profileUrl(request.username))}" title="Open @${escapeHtml(request.username)} on Hugging Face">@${escapeHtml(request.username)}</a>${request.email ? ` · <a class="person-link email-link" data-external href="${escapeHtml(emailSearchUrl(request.email))}" title="Search this email with Google">${escapeHtml(request.email)}</a>` : ""}</span></div></div></td>
      <td><a class="repo-link" data-external href="${escapeHtml(datasetUrl(request.repoId))}">${escapeHtml(request.repoId)}</a></td>
      <td><span class="date-primary">${escapeHtml(requested.date)}</span><span class="date-secondary">${escapeHtml(requested.time)}</span></td>
      <td><span class="status-pill status-${escapeHtml(request.status)}">${escapeHtml(request.status)}</span></td>
      <td><div class="row-actions">${actionButtons(request)}</div></td>
    </tr>`;
  }).join("");
  els.emptyState.classList.toggle("hidden", requests.length > 0);
  els.loadingState.classList.add("hidden");
  const visibleIds = requests.map((request) => request.id);
  els.selectAll.checked = Boolean(visibleIds.length) && visibleIds.every((id) => state.selected.has(id));
  els.selectAll.indeterminate = visibleIds.some((id) => state.selected.has(id)) && !els.selectAll.checked;
  renderBulkBar();
}

function renderBulkBar() {
  els.bulkBar.classList.toggle("hidden", state.selected.size === 0);
  els.selectedCount.textContent = state.selected.size;
}

function renderOverview() {
  const { data } = state;
  $("#statPending").textContent = data.counts.pending;
  $("#statDatasets").textContent = data.datasets.length;
  $("#statAccepted").textContent = data.counts.accepted;
  $("#navPending").textContent = data.counts.pending;
  $("#navAccepted").textContent = data.counts.accepted;
  $("#navRejected").textContent = data.counts.rejected;
  $("#navAll").textContent = data.requests.length;
  els.lastUpdated.textContent = `${data.cached ? "Cached" : "Updated"} ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(data.fetchedAt))}`;
  const issueCount = data.datasets.reduce((sum, dataset) => sum + dataset.errors.length, 0) + data.discoveryErrors.length;
  $("#datasetHealth").textContent = issueCount ? `${issueCount} API issue${issueCount === 1 ? "" : "s"}` : "connected";
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
  els.datasetFilter.innerHTML = `<option value="all">All datasets</option>${data.datasets.map((dataset) => `<option value="${escapeHtml(dataset.id)}">${escapeHtml(dataset.id)}</option>`).join("")}`;
  els.dashboardContent.classList.remove("hidden");
  els.setupPanel.classList.add("hidden");
  renderTable();
}

async function loadOverview(force = false) {
  els.refreshButton.disabled = true;
  els.refreshButton.classList.add("spinning");
  els.loadingState.classList.remove("hidden");
  try {
    state.data = await window.hfDesk.getOverview(force);
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
      items: pending.requests.map(({ repoId, username }) => ({ repoId, username })),
      reason: els.reasonInput.value.trim(),
    });
    els.dialog.close();
    state.selected.clear();
    toast(result.failed ? `${result.succeeded} succeeded; ${result.failed} failed.` : `${result.succeeded} request${result.succeeded === 1 ? "" : "s"} updated.`, result.failed ? "error" : "success");
    await loadOverview(true);
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
els.searchInput.addEventListener("input", () => { state.query = els.searchInput.value; state.selected.clear(); renderTable(); });
els.datasetFilter.addEventListener("change", () => { state.dataset = els.datasetFilter.value; state.selected.clear(); renderTable(); });
els.reasonInput.addEventListener("input", () => { els.reasonCount.textContent = els.reasonInput.value.length; });

$$('.nav-item').forEach((button) => button.addEventListener("click", () => {
  state.status = button.dataset.status;
  state.selected.clear();
  $$('.nav-item').forEach((item) => item.classList.toggle("active", item === button));
  els.pageTitle.textContent = { pending: "Pending review", accepted: "Accepted access", rejected: "Rejected requests", all: "All requests" }[state.status];
  renderTable();
}));

els.selectAll.addEventListener("change", () => {
  for (const request of visibleRequests()) if (els.selectAll.checked) state.selected.add(request.id); else state.selected.delete(request.id);
  renderTable();
});

els.requestRows.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".row-check");
  if (!checkbox) return;
  if (checkbox.checked) state.selected.add(checkbox.dataset.id); else state.selected.delete(checkbox.dataset.id);
  renderTable();
});

els.requestRows.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-external]");
  if (link) { event.preventDefault(); window.hfDesk.openExternal(link.href); return; }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const request = state.data.requests.find((item) => item.id === button.dataset.id);
  if (request) openConfirm(button.dataset.action, [request]);
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

async function start() {
  if (!window.hfDesk) {
    els.tokenError.textContent = "Launch this project with Electron; it no longer runs in a web browser.";
    return showSetup(false);
  }
  try {
    const credential = await window.hfDesk.getCredentialStatus();
    state.hasToken = credential.hasToken;
    if (!state.hasToken) return showSetup(false);
    showApp();
    await loadOverview();
  } catch (error) {
    showSetup(false);
    els.tokenError.textContent = friendlyError(error);
  }
}

start();
