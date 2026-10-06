const assert = require("node:assert/strict");
const { allowedExternalUrl } = require("../electron/external-links.cjs");

for (const url of [
  "https://huggingface.co/sample-user",
  "https://huggingface.co/datasets/sample-lab/example-dataset",
  "https://huggingface.co/settings/tokens",
  "https://www.google.com/search?q=sample.user%40example.com",
]) assert.equal(allowedExternalUrl(url), true, `Expected allowed URL: ${url}`);

for (const url of [
  "http://huggingface.co/sample-user",
  "https://evil.example/sample-user",
  "https://huggingface.co/sample-user?redirect=evil",
  "https://www.google.com/search?q=test&extra=value",
  "https://www.google.com/maps",
  "javascript:alert(1)",
]) assert.equal(allowedExternalUrl(url), false, `Expected blocked URL: ${url}`);

console.log("External-link allow-list checks passed.");
