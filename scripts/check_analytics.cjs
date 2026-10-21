const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDataset, recordSnapshot, importPublisherCsv, nextDatasetPage } = require("../electron/analytics.cjs");

test("metadata preserves zero while missing or invalid metrics remain unavailable", () => {
  const data = normalizeDataset({ id: "sample/data", downloads: 0, likes: -1, downloadsAllTime: null, createdAt: "bad", gated: true });
  assert.equal(data.downloads, 0);
  assert.equal(data.likes, null);
  assert.equal(data.downloadsAllTime, null);
  assert.equal(data.usedStorage, null);
  assert.equal(data.createdAt, null);
  assert.equal(data.gateMode, "Gated");
  assert.equal(normalizeDataset({ id: "../../invalid" }), null);
  assert.equal(normalizeDataset({ id: "../.." }), null);
});

test("observations update the same UTC day without inventing older history", () => {
  const dataset = normalizeDataset({ id: "sample/data", downloads: 100, downloadsAllTime: 500 });
  const initial = recordSnapshot([], [dataset], "2026-10-21T01:00:00Z");
  assert.equal(initial.length, 1);
  const updated = recordSnapshot(initial, [{ ...dataset, downloads: 120 }], "2026-10-21T09:00:00Z");
  assert.equal(updated.length, 1);
  assert.equal(updated[0].downloads, 120);
  const next = recordSnapshot(updated, [dataset], "2026-10-22T01:00:00Z");
  assert.equal(next.length, 2);
  const retained = recordSnapshot([...next, { ...next[0], day: "2020-01-01" }], [dataset], "2026-10-22T02:00:00Z");
  assert.equal(retained.length, 2);
});

test("pagination follows only the same HF dataset-author endpoint", () => {
  assert.equal(nextDatasetPage('<https://huggingface.co/api/datasets?author=sample&cursor=next>; rel="next"', "sample"), "/api/datasets?author=sample&cursor=next");
  assert.equal(nextDatasetPage(null, "sample"), null);
  assert.throws(() => nextDatasetPage('<https://example.com/api/datasets?author=sample>; rel="next"', "sample"));
  assert.throws(() => nextDatasetPage('<https://huggingface.co/api/datasets?author=other>; rel="next"', "sample"));
  assert.throws(() => nextDatasetPage('<https://huggingface.co/api/models?author=sample>; rel="next"', "sample"));
});

test("publisher CSV supports quoted fields, model filtering, and account scoping", () => {
  const csv = '\uFEFFrepoType,repoName,total,timestamp,downloads,comment\r\n' +
    'dataset,"sample/data",200,"2026-09-01T00:00:00Z",7,"has a comma, and ""quotes"""\r\n' +
    'model,sample/model,50,2026-09-01T00:00:00Z,3,skip\r\n' +
    'dataset,other/private,50,2026-09-01T00:00:00Z,3,skip\r\n';
  const imported = importPublisherCsv(csv, ["sample/data"]);
  assert.equal(imported.imported, 1);
  assert.deepEqual(imported.rows, [{ id: "sample/data", day: "2026-09-01", downloads: 7 }]);
  const merged = importPublisherCsv(csv.replace(",7,", ",0,"), ["sample/data"], imported.rows);
  assert.equal(merged.rows.length, 1);
  assert.equal(merged.rows[0].downloads, 0);
  const retained = importPublisherCsv(csv, ["sample/data"], [{ id: "sample/temporarily-hidden", day: "2026-08-01", downloads: 2 }]);
  assert.equal(retained.rows.length, 2);
});

test("malformed and unrelated publisher imports cannot silently add data", () => {
  assert.throws(() => importPublisherCsv("wrong,header\n1,2", ["sample/data"]));
  const header = "repoType,repoName,timestamp,downloads\n";
  assert.throws(() => importPublisherCsv(header + "dataset,sample/data,invalid,1", ["sample/data"]));
  assert.throws(() => importPublisherCsv(header + "dataset,sample/data,2026-09-01T00:00:00Z,-3", ["sample/data"]));
  assert.throws(() => importPublisherCsv(header + 'dataset,"sample/data', ["sample/data"]));
  assert.throws(() => importPublisherCsv(header + "dataset,other/private,2026-09-01T00:00:00Z,1", ["sample/data"]));
});
