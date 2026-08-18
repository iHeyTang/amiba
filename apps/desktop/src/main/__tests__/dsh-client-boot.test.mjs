import assert from "node:assert/strict";
import test from "node:test";

import {
  extractDshClientBootGraph,
  extractDshShellAssets,
  proxyDshClientFetch,
} from "../dsh-client-boot.ts";

test("extracts and absolutizes the host-composed DSH client graph", () => {
  const html = `<html><head><script>window.__DSH_BOOT__ = ${JSON.stringify({
    rev: "graph-rev",
    entries: [
      {
        id: "@amiba/dsh-plugin-ui-shell",
        url: "/plugins/@amiba/dsh-plugin-ui-shell/client.js?rev=abc",
        rev: "abc",
        inject: ["@deepseek-ai/dsh-client-runtime"],
      },
    ],
  })}</script></head></html>`;
  const graph = extractDshClientBootGraph(html, "http://127.0.0.1:43123");
  assert.equal(graph.rev, "graph-rev");
  assert.equal(
    graph.entries[0].url,
    "http://127.0.0.1:43123/plugins/@amiba/dsh-plugin-ui-shell/client.js?rev=abc",
  );
});

test("extracts only same-runtime DSH Web Shell assets", () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head></html>`;
  assert.deepEqual(
    extractDshShellAssets(html, "http://127.0.0.1:43123"),
    {
      scripts: ["http://127.0.0.1:43123/assets/index-abc.js"],
      styles: ["http://127.0.0.1:43123/assets/index-abc.css"],
    },
  );
});

test("rejects a client bundle outside the managed runtime origin", () => {
  const html = `<script>window.__DSH_BOOT__ = ${JSON.stringify({
    rev: "x",
    entries: [
      { id: "bad", url: "https://example.com/client.js", rev: "x" },
    ],
  })}</script>`;
  assert.throws(
    () => extractDshClientBootGraph(html, "http://127.0.0.1:43123"),
    /escaped its runtime origin/u,
  );
});

test("refuses to proxy non-API targets", async () => {
  await assert.rejects(
    proxyDshClientFetch(
      {
        ensureStarted: async () => ({ baseUrl: "http://127.0.0.1:43123" }),
      },
      {
        url: "http://127.0.0.1:43123/plugins/x/client.js",
        method: "GET",
        headers: {},
      },
    ),
    /refused a non-runtime API URL/u,
  );
});
