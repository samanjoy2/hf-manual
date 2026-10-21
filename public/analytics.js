const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const known = (value) => Number.isFinite(value) && value >= 0;
const integer = (value) => known(value) ? new Intl.NumberFormat().format(value) : "—";
const repoUrl = (id) => `https://huggingface.co/datasets/${id.split("/").map(encodeURIComponent).join("/")}`;
const metricLabels = { downloads: "Downloads in the last 30 days", downloadsAllTime: "All-time downloads", likes: "Likes", usedStorage: "Storage used" };

function bytes(value) {
  if (!known(value)) return "—";
  if (!value) return "0 B";
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${["B", "KiB", "MiB", "GiB", "TiB"][index]}`;
}
const format = (value, metric) => metric === "usedStorage" ? bytes(value) : integer(value);
const date = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)) : "—";
const quote = (value) => {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export class DatasetAnalytics {
  constructor({ onLoaded, onMessage }) {
    this.data = null;
    this.operation = null;
    this.onLoaded = onLoaded;
    this.onMessage = onMessage;
    this.dataset = "all";
    this.metric = "downloads";
    this.range = "30";
    this.source = "local";
    this.generation = 0;
    for (const [id, key] of [["analyticsDataset", "dataset"], ["analyticsMetric", "metric"], ["analyticsRange", "range"], ["analyticsSource", "source"]]) {
      $(id).addEventListener("change", () => { this[key] = $(id).value; this.render(); });
    }
    $("analyticsExport").addEventListener("click", () => this.exportCsv());
    $("analyticsImport").addEventListener("click", async () => {
      const generation = this.generation;
      $("analyticsImport").disabled = true;
      try {
        const result = await window.hfDesk.importAnalyticsHistory();
        if (result.canceled || generation !== this.generation) return;
        this.source = "publisher";
        $("analyticsSource").value = this.source;
        this.accept(result.data);
        this.onMessage(`Imported ${integer(result.imported)} daily download records.`);
      } catch (error) { this.onMessage(error.message, "error"); }
      finally { $("analyticsImport").disabled = false; }
    });
    this.render();
  }

  reset() {
    this.generation++;
    this.data = null;
    this.dataset = "all";
    this.source = "local";
    $("analyticsDataset").innerHTML = '<option value="all">All datasets</option>';
    $("analyticsSource").value = "local";
    this.render();
  }

  async load(force = false) {
    if (this.operation) return this.operation;
    const generation = this.generation;
    $("analyticsLoading").classList.remove("hidden");
    this.operation = (async () => {
      try {
        const data = await window.hfDesk.getAnalytics(force);
        if (generation === this.generation) this.accept(data);
      } catch (error) {
        $("analyticsWarning").textContent = error.message;
        $("analyticsWarning").classList.remove("hidden");
      } finally {
        this.operation = null;
        $("analyticsLoading").classList.add("hidden");
      }
    })();
    return this.operation;
  }

  accept(data) {
    this.data = data;
    if (!data.datasets.some((dataset) => dataset.id === this.dataset)) this.dataset = "all";
    $("analyticsDataset").innerHTML = '<option value="all">All datasets</option>' + data.datasets.map((dataset) => `<option value="${escape(dataset.id)}">${escape(dataset.id)}</option>`).join("");
    $("analyticsDataset").value = this.dataset;
    this.render();
    this.onLoaded(data);
  }

  selected() {
    return (this.data?.datasets || []).filter((dataset) => this.dataset === "all" || dataset.id === this.dataset);
  }

  render() {
    const datasets = this.selected();
    const errors = this.data?.errors || [];
    $("analyticsWarning").classList.toggle("hidden", !errors.length);
    $("analyticsWarning").textContent = errors.map((error) => `${error.namespace}: ${error.message}`).join(" · ");
    $("analyticsExport").disabled = !datasets.length;
    $("analyticsImport").disabled = !this.data?.datasets.length;
    $("analyticsSummary").innerHTML = [["downloads", "Downloads · last 30 days"], ["downloadsAllTime", "All-time downloads"], ["likes", "Total likes"], ["usedStorage", "Storage used"]].map(([metric, label]) => {
      const rows = datasets.filter((dataset) => known(dataset[metric]));
      const total = rows.length ? rows.reduce((sum, dataset) => sum + dataset[metric], 0) : null;
      return `<div class="analytics-stat"><span>${label}</span><strong>${format(total, metric)}</strong><small>${rows.length === datasets.length && rows.length ? `${rows.length} dataset${rows.length === 1 ? "" : "s"}` : `${rows.length} of ${datasets.length} datasets reporting`}</small></div>`;
    }).join("");
    $("analyticsComparisonLabel").textContent = metricLabels[this.metric];
    const ranked = [...datasets].sort((a, b) => (b[this.metric] ?? -1) - (a[this.metric] ?? -1));
    const top = ranked.filter((dataset) => known(dataset[this.metric])).slice(0, 8);
    const max = Math.max(1, ...top.map((dataset) => dataset[this.metric]));
    $("analyticsBars").innerHTML = top.length ? top.map((dataset) => `<div class="analytics-bar"><div><a data-external href="${escape(repoUrl(dataset.id))}" title="${escape(dataset.id)}">${escape(dataset.id)}</a><strong>${format(dataset[this.metric], this.metric)}</strong></div><svg class="analytics-meter" viewBox="0 0 400 8" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-track" width="400" height="8" rx="3"/><rect class="bar-fill" width="${dataset[this.metric] / max * 400}" height="8" rx="3"/></svg></div>`).join("") : '<p class="analytics-placeholder">No values are available for this metric yet.</p>';
    $("analyticsCoverage").textContent = `${datasets.length} dataset${datasets.length === 1 ? "" : "s"} · gated and open repositories · UTC dates`;
    $("analyticsRows").innerHTML = ranked.map((dataset) => `<tr><td><a class="repo-link" data-external href="${escape(repoUrl(dataset.id))}">${escape(dataset.id)}</a>${dataset.private ? '<span class="dataset-private">Private</span>' : ""}</td><td>${integer(dataset.downloads)}</td><td>${integer(dataset.downloadsAllTime)}</td><td>${integer(dataset.likes)}</td><td>${bytes(dataset.usedStorage)}</td><td>${date(dataset.createdAt)}</td><td>${date(dataset.lastModified)}</td><td>${escape(dataset.gateMode)}</td></tr>`).join("") || '<tr><td colspan="8" class="analytics-placeholder">No datasets were returned for this account.</td></tr>';
    this.renderTrend(datasets);
  }

  renderTrend(datasets) {
    const publisher = this.source === "publisher";
    const history = publisher ? this.data?.publisherHistory || [] : this.data?.history || [];
    const metric = publisher ? "downloads" : this.metric;
    const allowed = new Set(datasets.map((dataset) => dataset.id));
    const cutoff = this.range === "all" ? "0000" : new Date(Date.now() - (Number(this.range) - 1) * 86_400_000).toISOString().slice(0, 10);
    const days = new Map();
    for (const row of history) {
      if (!allowed.has(row.id) || row.day < cutoff || !known(row[metric])) continue;
      if (!days.has(row.day)) days.set(row.day, new Map());
      days.get(row.day).set(row.id, row[metric]);
    }
    const points = [...days.entries()].filter(([, entries]) => entries.size === allowed.size && allowed.size)
      .map(([day, entries]) => ({ day, value: [...entries.values()].reduce((sum, value) => sum + value, 0) })).sort((a, b) => a.day.localeCompare(b.day));
    $("analyticsTrendTitle").textContent = publisher ? "Daily downloads · HF history" : "Locally tracked trend";
    $("analyticsTrendLabel").textContent = publisher ? "Actual daily download records from your imported CSV" : metricLabels[metric];
    $("analyticsTrendHelp").textContent = publisher
      ? "Imported Hugging Face daily records. Only dates reported for every selected dataset are plotted. Missing days are not treated as zero."
      : "One recorded counter per dataset per UTC day, updated while the app is open. This is not daily download volume. Only dates with data for every selected dataset are plotted; earlier history is not reconstructed.";
    if (!points.length) {
      const existing = history.some((row) => allowed.has(row.id));
      $("analyticsTrend").innerHTML = `<div class="analytics-placeholder"><strong>${publisher ? "No complete daily history in this view" : existing ? "No complete observations for this metric" : "Your history starts here"}</strong><p>${publisher ? "Import a Publisher Analytics CSV, select one dataset, or expand the time range." : existing ? "Try one dataset, another metric, or a wider time range. Missing values are not estimated." : "Refresh analytics to record the first observation. More points appear as you use the app on subsequent days."}</p></div>`;
      return;
    }
    const width = 520, height = 190, left = 56, right = 12, top = 15, bottom = 28;
    const maximum = Math.max(1, ...points.map((point) => point.value));
    const first = new Date(points[0].day).getTime(), last = new Date(points.at(-1).day).getTime();
    const plotted = points.length > 180 ? points.filter((_, i) => i % Math.ceil(points.length / 180) === 0 || i === points.length - 1) : points;
    const positioned = plotted.map((point) => ({ ...point,
      x: points.length === 1 ? (left + width - right) / 2 : left + (new Date(point.day).getTime() - first) / Math.max(1, last - first) * (width - left - right),
      y: height - bottom - point.value / maximum * (height - bottom - top),
    }));
    const path = positioned.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const label = `${publisher ? "Daily downloads" : metricLabels[metric]}: ${points.length} recorded dates, ${date(points[0].day)} to ${date(points.at(-1).day)}.`;
    $("analyticsTrend").innerHTML = `<svg class="analytics-plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(label)}">${[0, .5, 1].map((fraction) => {
      const y = height - bottom - fraction * (height - bottom - top);
      return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-text" x="${left - 8}" y="${y + 4}" text-anchor="end">${escape(format(maximum * fraction, publisher ? "downloads" : metric))}</text>`;
    }).join("")}<path class="chart-line" d="${path}"/>${positioned.map((point) => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="3"><title>${escape(`${date(point.day)}: ${format(point.value, publisher ? "downloads" : metric)}`)}</title></circle>`).join("")}<text class="chart-text" x="${left}" y="${height - 5}">${escape(date(points[0].day))}</text><text class="chart-text" x="${width - right}" y="${height - 5}" text-anchor="end">${points.length > 1 ? escape(date(points.at(-1).day)) : ""}</text></svg><details class="analytics-points"><summary>${points.length} observation${points.length === 1 ? "" : "s"}${points.length > 50 ? " · latest 50 shown below" : ""}</summary><table><thead><tr><th>Date (UTC)</th><th>${escape(publisher ? "Daily downloads" : metricLabels[metric])}</th></tr></thead><tbody>${points.slice(-50).map((point) => `<tr><td>${date(point.day)}</td><td>${format(point.value, publisher ? "downloads" : metric)}</td></tr>`).join("")}</tbody></table></details>`;
  }

  exportCsv() {
    if (!this.data) return;
    const columns = ["dataset", "downloads_last_30_days", "downloads_all_time", "likes", "storage_bytes", "created_at", "last_modified", "access", "private", "fetched_at"];
    const rows = this.selected().map((dataset) => [dataset.id, dataset.downloads, dataset.downloadsAllTime, dataset.likes, dataset.usedStorage, dataset.createdAt, dataset.lastModified, dataset.gateMode, dataset.private, this.data.fetchedAt]);
    const blob = new Blob([[columns, ...rows].map((row) => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `hf-dataset-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }
}
