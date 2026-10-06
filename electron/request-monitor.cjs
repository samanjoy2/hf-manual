const { createHash } = require("node:crypto");

function requestKey(request) {
  return createHash("sha256").update(JSON.stringify([
    request.repoId, request.username, request.requestedAt || "",
  ])).digest("hex");
}

// Keep seen requests through temporary API failures and decisions made in this app.
function observeRequests(snapshot, overview) {
  const account = overview.account.username;
  const initialized = snapshot?.account === account;
  const known = new Set(initialized ? snapshot.keys : []);
  const added = overview.requests.filter((request) => request.status === "pending" && !known.has(requestKey(request)));
  for (const request of overview.requests) known.add(requestKey(request));
  return {
    snapshot: { account, keys: [...known].slice(-20_000) },
    added: initialized ? added : [],
  };
}

module.exports = { observeRequests };
