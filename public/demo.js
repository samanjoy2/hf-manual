(() => {
  const demoParams = new URLSearchParams(window.location.search);
  const demoView = demoParams.get("demo");
  if (!demoView || window.hfDesk) return;
  if (demoParams.get("sidebar") === "collapsed") localStorage.setItem("hf-access-desk:sidebar-collapsed", "true");

  const datasets = [
    { id: "sample-lab/Clinical-Language-Benchmark", gated: "manual", private: false, namespace: "sample-lab", errors: [] },
    { id: "sample-lab/Regional-Speech-Corpus", gated: "manual", private: true, namespace: "sample-lab", errors: [] },
    { id: "demo-research/Safety-Evaluation-Suite", gated: "manual", private: false, namespace: "demo-research", errors: [] },
  ];
  const requests = [
    ["pending-01", "Clinical-Language-Benchmark", "Sample Researcher", "SR", "pending", "2026-10-06T15:42:00Z", { affiliation: "Example University", intendedUse: "Academic evaluation of multilingual models", acceptedTerms: true }],
    ["pending-02", "Regional-Speech-Corpus", "Demo Reviewer", "DR", "pending", "2026-10-05T13:18:00Z", { organization: "Demo Research Lab", purpose: "Speech recognition benchmarking" }],
    ["pending-03", "Safety-Evaluation-Suite", "Example Scientist", "ES", "pending", "2026-10-04T09:05:00Z", { useCase: "Safety research" }],
    ["pending-04", "Clinical-Language-Benchmark", "Test Contributor", "TC", "pending", "2026-10-03T16:31:00Z", null],
    ["accepted-01", "Regional-Speech-Corpus", "Sample Researcher", "SR", "accepted", "2026-09-20T12:10:00Z", { affiliation: "Example University" }],
    ["accepted-02", "Safety-Evaluation-Suite", "Demo Engineer", "DE", "accepted", "2026-09-19T08:55:00Z", null],
    ["rejected-01", "Clinical-Language-Benchmark", "Example Applicant", "EA", "rejected", "2026-09-18T14:24:00Z", null],
  ].map(([id, dataset, fullname, username, status, requestedAt, fields]) => ({
    id,
    repoId: `${dataset === "Safety-Evaluation-Suite" ? "demo-research" : "sample-lab"}/${dataset}`,
    fullname,
    username,
    email: "",
    status,
    requestedAt,
    reviewedAt: status === "pending" ? null : "2026-09-21T10:00:00Z",
    fields,
  }));

  const auditLog = [
    { id: "audit-01", timestamp: "2026-10-05T10:20:00Z", action: "accepted", previousStatus: "pending", repoId: "sample-lab/Regional-Speech-Corpus", username: "SR", reason: "" },
    { id: "audit-02", timestamp: "2026-10-02T08:10:00Z", action: "rejected", previousStatus: "pending", repoId: "demo-research/Safety-Evaluation-Suite", username: "EA", reason: "Use case needs clarification" },
  ];

  if (demoParams.get("rows") === "65") {
    for (let i = 1; i <= 65; i++) requests.push({
      id: `large-demo-${i}`, repoId: datasets[i % datasets.length].id,
      fullname: `Demo Researcher ${i}`, username: `sample-user-${i}`, email: "",
      status: "pending", requestedAt: "2026-10-09T12:00:00Z", reviewedAt: null, fields: null,
    });
  }
  const overview = {
    account: { username: "Demo Workspace", avatarUrl: null },
    namespaces: ["sample-lab", "demo-research"],
    datasets,
    requests,
    counts: { pending: requests.filter((item) => item.status === "pending").length, accepted: 2, rejected: 1 },
    discoveryErrors: [],
    fetchedAt: "2026-09-26T14:30:00Z",
    cached: false,
  };

  const analyticsDatasets = [
    [datasets[0].id, 1460, 18320, 84, 2483027968, "Manual", false],
    [datasets[1].id, 980, 9460, 42, 8145764352, "Manual", true],
    [datasets[2].id, 720, 5120, 31, 524288000, "Manual", false],
    ["sample-lab/Community-Text-Set", 530, 22100, 109, 4294967296, "Open", false],
    ["demo-research/Small-Evaluation", 120, null, 8, null, "Open", false],
  ].map(([id, downloads, downloadsAllTime, likes, usedStorage, gateMode, privateRepo]) => ({ id, downloads, downloadsAllTime, likes, usedStorage, gateMode, private: privateRepo, gated: gateMode !== "Open", createdAt: "2025-02-10T10:00:00Z", lastModified: "2026-10-14T12:00:00Z", tags: [] }));
  const history = [];
  const publisherHistory = [];
  for (let i = 29; i >= 0; i--) {
    const timestamp = new Date(Date.now() - i * 86_400_000).toISOString();
    for (let j = 0; j < analyticsDatasets.length; j++) {
      const dataset = analyticsDatasets[j];
      history.push({ id: dataset.id, day: timestamp.slice(0, 10), timestamp, downloads: Math.round(dataset.downloads * (1 - i * .012) + (i ? Math.sin(i / 3 + j) * 25 : 0)), downloadsAllTime: dataset.downloadsAllTime === null ? null : dataset.downloadsAllTime - i * 30, likes: dataset.likes, usedStorage: dataset.usedStorage });
      publisherHistory.push({ id: dataset.id, day: timestamp.slice(0, 10), downloads: Math.round(dataset.downloads / 30 + Math.sin(i / 2 + j) * 3) });
    }
  }
  const analyticsData = { account: "Demo Workspace", datasets: analyticsDatasets, namespaces: ["sample-lab", "demo-research"], history, publisherHistory: [], errors: [], fetchedAt: new Date().toISOString() };

  let preferences = { theme: "dark", refreshMinutes: 5, notifications: true, checkUpdates: true, updateNotifications: true };
  try { preferences = { ...preferences, ...JSON.parse(localStorage.getItem("hf-access-desk:demo-settings") || "{}") }; } catch { /* Use defaults. */ }
  const updateStatus = { status: "current", currentVersion: "1.4.0", message: "Version 1.4.0 is up to date." };
  window.hfDesk = Object.freeze({
    getCredentialStatus: async () => ({ hasToken: demoView !== "setup" }),
    saveCredential: async () => ({ saved: true, username: "Demo Workspace" }),
    forgetCredential: async () => ({ forgotten: true }),
    getOverview: async () => overview,
    updateRequests: async ({ items = [] }) => ({ results: [], succeeded: items.length, failed: 0 }),
    getAuditLog: async () => auditLog,
    getAnalytics: async () => analyticsData,
    importAnalyticsHistory: async () => { analyticsData.publisherHistory = publisherHistory; return { canceled: false, imported: publisherHistory.length, data: analyticsData }; },
    onAnalytics: () => () => {},
    getSettings: async () => preferences,
    saveSettings: async (value) => {
      preferences = value;
      localStorage.setItem("hf-access-desk:demo-settings", JSON.stringify(value));
      return preferences;
    },
    getUpdateStatus: async () => updateStatus,
    checkUpdates: async () => updateStatus,
    downloadUpdate: async () => updateStatus,
    installUpdate: async () => true,
    onOverview: () => () => {},
    onRefreshError: () => () => {},
    onOpenPending: () => () => {},
    onUpdateStatus: () => () => {},
    onOpenUpdates: () => () => {},
    openExternal: async () => true,
  });
})();
