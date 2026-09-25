const state = {
  data: null,
  status: "pending",
  query: "",
  dataset: "all",
  selected: new Set(),
  authRequired: false,
  pendingAction: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const els = {
  loginView: $("#loginView"), appView: $("#appView"), loginForm: $("#loginForm"), password: $("#password"), loginError: $("#loginError"),
  dashboardContent: $("#dashboardContent"), setupPanel: $("#setupPanel"), loadingState: $("#loadingState"), emptyState: $("#emptyState"),
  requestRows: $("#requestRows"), searchInput: $("#searchInput"), datasetFilter: $("#datasetFilter"), selectAll: $("#selectAll"),
  bulkBar: $("#bulkBar"), selectedCount: $("#selectedCount"), refreshButton: $("#refreshButton"), exportButton: $("#exportButton"),
  pageTitle: $("#pageTitle"), lastUpdated: $("#lastUpdated"), warningBar: $("#warningBar"), accountMini: $("#accountMini"), logoutButton: $("#logoutButton"),
  dialog: $("#confirmDialog"), confirmForm: $("#confirmForm"), confirmTitle: $("#confirmTitle"), confirmMessage: $("#confirmMessage"), confirmAction: $("#confirmAction"),
  reasonWrap: $("#reasonWrap"), reasonInput: $("#reasonInput"), reasonCount: $("#reasonCount"), toastRegion: $("#toastRegion"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login") showLogin();
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function showLogin() {
  els.appView.classList.add("hidden");
  els.loginView.classList.remove("hidden");
  setTimeout(() => els.password.focus(), 0);
}

function showApp() {
  els.loginView.classList.add("hidden");
  els.appView.classList.remove("hidden");
  els.logoutButton.classList.toggle("hidden", !state.authRequired);
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
    return [request.username, request.fullname, request.email, request.repoId]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function actionButtons(request) {
  const data = `data-id="${escapeHtml(request.id)}"`;
  if (request.status === "pending") {
    return `<button class="row-button danger" data-action="rejected" ${data}>Reject</button><button class="row-button approve" data-action="accepted" ${data}>Approve</button>`;
  }
  if (request.status === "accepted") {
    return `<button class="row-button" data-action="pending" ${data}>Move to pending</button><button class="row-button danger" data-action="rejected" ${data}>Revoke</button>`;
  }
  return `<button class="row-button" data-action="reset" ${data}>Reset request</button><button class="row-button approve" data-action="accepted" ${data}>Approve</button>`;
}

function renderTable() {
  const requests = visibleRequests();
  els.requestRows.innerHTML = requests.map((request) => {
    const requested = formatDate(request.requestedAt);
    return `<tr>
      <td class="check-cell"><input class="row-check" type="checkbox" aria-label="Select ${escapeHtml(request.username)}" data-id="${escapeHtml(request.id)}" ${state.selected.has(request.id) ? "checked" : ""}></td>
      <td><div class="person"><span class="initial">${escapeHtml(initials(request.fullname || request.username))}</span><div><strong>${escapeHtml(request.fullname || request.username)}</strong><span>@${escapeHtml(request.username)}${request.email ? ` · ${escapeHtml(request.email)}` : ""}</span></div></div></td>
      <td><a class="repo-link" href="https://huggingface.co/datasets/${encodeURI(request.repoId)}" target="_blank" rel="noreferrer">${escapeHtml(request.repoId)}</a></td>
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
  const count = state.selected.size;
  els.bulkBar.classList.toggle("hidden", count === 0);
  els.selectedCount.textContent = count;
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
  els.datasetFilter.innerHTML = `<option value="all">All datasets</option>${data.datasets.map((dataset) => `<option value="${escapeHtml(dataset.id)}">${escapeHtml(dataset.id)}</option>`).join("")}`;
  els.dashboardContent.classList.remove("hidden");
  renderTable();
}

function showSetup(message) {
  els.dashboardContent.classList.add("hidden");
  els.setupPanel.classList.remove("hidden");
  els.setupPanel.innerHTML = `<p class="eyebrow">One-time setup</p><h2>Connect your Hugging Face account</h2><p>${escapeHtml(message)}</p><ol><li>Copy <code>.env.example</code> to <code>.env</code>.</li><li>Set <code>HF_TOKEN</code> to a write-enabled user access token.</li><li>Restart the app, then refresh this page.</li></ol>`;
}

async function loadOverview(force = false) {
  els.refreshButton.disabled = true;
  els.refreshButton.classList.add("spinning");
  els.loadingState.classList.remove("hidden");
  try {
    state.data = await api(`/api/overview${force ? "?refresh=1" : ""}`);
    els.setupPanel.classList.add("hidden");
    renderOverview();
  } catch (error) {
    if (/HF_TOKEN is not configured/.test(error.message)) showSetup(error.message);
    else {
      els.loadingState.classList.add("hidden");
      toast(error.message, "error");
      if (!state.data) showSetup(error.message);
    }
  } finally {
    els.refreshButton.disabled = false;
    els.refreshButton.classList.remove("spinning");
  }
}

function findRequests(ids) {
  return state.data.requests.filter((request) => ids.includes(request.id));
}

function openConfirm(action, requests) {
  const labels = { accepted: "Approve", rejected: requests.some((r) => r.status === "accepted") ? "Revoke" : "Reject", pending: "Move", reset: "Reset" };
  const label = labels[action];
  const count = requests.length;
  state.pendingAction = { action, requests };
  els.confirmTitle.textContent = `${label} ${count === 1 ? "this request" : `${count} requests`}?`;
  els.confirmMessage.textContent = action === "rejected"
    ? "The selected users will not be able to access the corresponding datasets."
    : action === "accepted" ? "The selected users will receive access to the corresponding datasets."
    : action === "reset" ? "Users will need to agree to the terms and submit a new request."
    : "The selected requests will return to the pending queue.";
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
    const result = await api("/api/requests/action", {
      method: "POST",
      body: JSON.stringify({
        action: pending.action,
        items: pending.requests.map(({ repoId, username }) => ({ repoId, username })),
        reason: els.reasonInput.value.trim(),
      }),
    });
    els.dialog.close();
    state.selected.clear();
    toast(result.failed ? `${result.succeeded} succeeded; ${result.failed} failed.` : `${result.succeeded} request${result.succeeded === 1 ? "" : "s"} updated.` , result.failed ? "error" : "success");
    await loadOverview(true);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    els.confirmAction.disabled = false;
    state.pendingAction = null;
  }
}

function exportCsv() {
  const rows = visibleRequests();
  const columns = ["status", "dataset", "username", "full name", "email", "requested at", "reviewed at", "custom fields"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [columns, ...rows.map((r) => [r.status, r.repoId, r.username, r.fullname, r.email, r.requestedAt, r.reviewedAt, r.fields ? JSON.stringify(r.fields) : ""])].map((row) => row.map(quote).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `hf-access-requests-${state.status}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.textContent = "";
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: els.password.value }) });
    els.password.value = "";
    showApp();
    await loadOverview();
  } catch (error) { els.loginError.textContent = error.message; }
});

els.logoutButton.addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST", body: "{}" }); showLogin(); });
els.refreshButton.addEventListener("click", () => loadOverview(true));
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
  for (const request of visibleRequests()) {
    if (els.selectAll.checked) state.selected.add(request.id); else state.selected.delete(request.id);
  }
  renderTable();
});

els.requestRows.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".row-check");
  if (!checkbox) return;
  if (checkbox.checked) state.selected.add(checkbox.dataset.id); else state.selected.delete(checkbox.dataset.id);
  renderTable();
});

els.requestRows.addEventListener("click", (event) => {
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
  const submitter = event.submitter?.value;
  if (submitter !== "confirm") { state.pendingAction = null; return; }
  event.preventDefault();
  performAction();
});

async function start() {
  try {
    const auth = await api("/api/auth/status");
    state.authRequired = auth.required;
    if (!auth.authenticated) return showLogin();
    showApp();
    await loadOverview();
  } catch (error) {
    showApp();
    showSetup(error.message);
  }
}

start();
