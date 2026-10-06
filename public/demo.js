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
    ["pending-01", "Clinical-Language-Benchmark", "Sample Researcher", "SR", "pending", "2026-09-26T07:42:00Z"],
    ["pending-02", "Regional-Speech-Corpus", "Demo Reviewer", "DR", "pending", "2026-09-25T13:18:00Z"],
    ["pending-03", "Safety-Evaluation-Suite", "Example Scientist", "ES", "pending", "2026-09-24T09:05:00Z"],
    ["pending-04", "Clinical-Language-Benchmark", "Test Contributor", "TC", "pending", "2026-09-23T16:31:00Z"],
    ["accepted-01", "Regional-Speech-Corpus", "Sample Analyst", "SA", "accepted", "2026-09-20T12:10:00Z"],
    ["accepted-02", "Safety-Evaluation-Suite", "Demo Engineer", "DE", "accepted", "2026-09-19T08:55:00Z"],
    ["rejected-01", "Clinical-Language-Benchmark", "Example Applicant", "EA", "rejected", "2026-09-18T14:24:00Z"],
  ].map(([id, dataset, fullname, username, status, requestedAt]) => ({
    id,
    repoId: `${dataset === "Safety-Evaluation-Suite" ? "demo-research" : "sample-lab"}/${dataset}`,
    fullname,
    username,
    email: "",
    status,
    requestedAt,
  }));

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
    openExternal: async () => true,
  });
})();
