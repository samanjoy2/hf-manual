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

  const overview = {
    account: { username: "Demo Workspace", avatarUrl: null },
    namespaces: ["sample-lab", "demo-research"],
    datasets,
    requests,
    counts: { pending: 4, accepted: 2, rejected: 1 },
    discoveryErrors: [],
    fetchedAt: "2026-09-26T14:30:00Z",
    cached: false,
  };

  window.hfDesk = Object.freeze({
    getCredentialStatus: async () => ({ hasToken: demoView !== "setup" }),
    saveCredential: async () => ({ saved: true, username: "Demo Workspace" }),
    forgetCredential: async () => ({ forgotten: true }),
    getOverview: async () => overview,
    updateRequests: async ({ items = [] }) => ({ results: [], succeeded: items.length, failed: 0 }),
    getAuditLog: async () => auditLog,
    openExternal: async () => true,
  });
})();
