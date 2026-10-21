const METRICS = ["downloads", "downloadsAllTime", "likes", "usedStorage"];

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function date(value) {
  const parsed = typeof value === "string" ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeDataset(raw) {
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(id) || id.split("/").some((part) => part === "." || part === "..")) return null;
  return {
    id, private: Boolean(raw.private), gated: raw.gated === true || ["manual", "auto"].includes(raw.gated),
    gateMode: raw.gated === "manual" ? "Manual" : raw.gated === "auto" ? "Automatic" : raw.gated === true ? "Gated" : "Open",
    createdAt: date(raw.createdAt), lastModified: date(raw.lastModified),
    ...Object.fromEntries(METRICS.map((key) => [key, count(raw[key])])),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === "string").slice(0, 100) : [],
  };
}

function recordSnapshot(history, datasets, timestamp) {
  const day = timestamp.slice(0, 10);
  const cutoff = new Date(new Date(timestamp).getTime() - 730 * 86_400_000).toISOString().slice(0, 10);
  const byKey = new Map((Array.isArray(history) ? history : []).filter((row) => row.day >= cutoff)
    .map((row) => [`${row.id}:${row.day}`, row]));
  for (const dataset of datasets) byKey.set(`${dataset.id}:${day}`, {
    id: dataset.id, day, timestamp,
    ...Object.fromEntries(METRICS.map((key) => [key, count(dataset[key])])),
  });
  return [...byKey.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-100_000);
}

// RFC4180-style quoting, including commas, escaped quotes, and CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      row.push(field); field = "";
      if (char !== ",") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
        if (rows.length > 100_001) throw new Error("Import supports up to 100,000 daily records.");
      }
    } else field += char;
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function importPublisherCsv(text, datasetIds, existing = []) {
  const rows = parseCsv(String(text).replace(/^\uFEFF/, ""));
  const header = rows.shift()?.map((value) => value.trim());
  const required = ["repoType", "repoName", "timestamp", "downloads"];
  if (!header || required.some((key) => !header.includes(key))) throw new Error("Choose a Hugging Face publisher CSV with repoType, repoName, timestamp, and downloads columns.");
  const index = Object.fromEntries(header.map((key, i) => [key, i]));
  const allowed = new Set(datasetIds);
  // Keep earlier records if a repository is temporarily absent from the catalog.
  // Account isolation is enforced by the encrypted store that supplies existing.
  const merged = new Map(existing.map((item) => [`${item.id}:${item.day}`, item]));
  let imported = 0;
  for (const row of rows) {
    if (row[index.repoType]?.trim() !== "dataset" || !allowed.has(row[index.repoName]?.trim())) continue;
    const timestamp = date(row[index.timestamp]?.trim().replace(/\s+T/, "T").replace(/\s+Z$/, "Z"));
    const numeric = row[index.downloads]?.trim();
    if (!timestamp || !/^\d+$/.test(numeric || "") || count(Number(numeric)) === null) throw new Error("A matching dataset record has an invalid date or download count.");
    const id = row[index.repoName].trim();
    const day = timestamp.slice(0, 10);
    merged.set(`${id}:${day}`, { id, day, downloads: Number(numeric) });
    imported++;
  }
  if (!imported) throw new Error("No daily records matched datasets in the connected account.");
  return { imported, rows: [...merged.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-100_000) };
}

function nextDatasetPage(link, namespace) {
  const match = /<([^>]+)>;\s*rel="next"/.exec(link || "");
  if (!match) return null;
  const url = new URL(match[1], "https://huggingface.co");
  if (url.origin !== "https://huggingface.co" || url.pathname !== "/api/datasets" || url.searchParams.get("author") !== namespace) throw new Error("Hugging Face returned an invalid dataset pagination link.");
  return url.pathname + url.search;
}

module.exports = { normalizeDataset, recordSnapshot, importPublisherCsv, nextDatasetPage };
