import assert from "node:assert/strict";
import test from "node:test";

import {
  extractDshClientBootGraph,
  extractDshShellAssets,
  proxyDshClientFetch,
  resolveDshSessionDownloadUrl,
} from "../dsh-client-boot.ts";

test("extracts and absolutizes the host-composed DSH client graph", () => {
  const html = `<html><head><script>globalThis["__DSH_BOOT__"] = ${JSON.stringify({
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

test("preserves module arrival edges separately from plugin injection edges", () => {
  const entry = { id: "@amiba/dsh-plugin-catalog", url: "/plugins/@amiba/dsh-plugin-catalog/client.js", rev: "one",
    inject: ["@amiba/dsh-plugin-ui-shell"], external: ["@amiba/dsh-plugin-ui-shell/client"] };
  const html = `<script>window.__DSH_BOOT__ = ${JSON.stringify({ rev: "one", entries: [entry] })}</script>`;
  const graph = extractDshClientBootGraph(html, "http://127.0.0.1:43123");
  assert.deepEqual(graph.entries[0].external, entry.external);
  assert.deepEqual(graph.entries[0].inject, entry.inject);
  for (const external of ["wrong", [1], [null]]) {
    assert.throws(() => extractDshClientBootGraph(`<script>window.__DSH_BOOT__ = ${JSON.stringify({ rev: "one", entries: [{ ...entry, external }] })}</script>`, "http://127.0.0.1:43123"), /invalid external edges/);
  }
});

test("extracts only same-runtime DSH Web Shell assets", () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head></html>`;
  assert.deepEqual(
    extractDshShellAssets(html, "http://127.0.0.1:43123"),
    {
      bootstrap: [],
      preload: [],
      scripts: ["http://127.0.0.1:43123/assets/index-abc.js"],
      styles: ["http://127.0.0.1:43123/assets/index-abc.css"],
    },
  );
});

test("accepts either spelling of the boot assignment", () => {
  // The webserver renders this row itself: 0.1.0 emitted `window.__DSH_BOOT__`,
  // 0.1.1 emits `globalThis["__DSH_BOOT__"]`. Reading only the first spelling
  // is what broke desktop boot on the 0.1.1 upgrade with "did not publish
  // __DSH_BOOT__" — a fixture written in a spelling upstream no longer used
  // kept the suite green while the real app could not start.
  const graph = { rev: "r", entries: [] };
  for (const assignment of [
    'window.__DSH_BOOT__ = ',
    'globalThis["__DSH_BOOT__"] = ',
    "globalThis['__DSH_BOOT__'] = ",
  ]) {
    const html = `<script>${assignment}${JSON.stringify(graph)}</script>`;
    assert.deepEqual(
      extractDshClientBootGraph(html, "http://127.0.0.1:43123").entries,
      [],
    );
  }
});

test("carries the inline bootstrap facade, and not the boot global", () => {
  // Shape taken from a live 0.1.1 runtime's document head, in order:
  //   1. inline  — installs window.__ModuleLoader__
  //   2. src     — plugin bundle, fetched by the loader from the graph
  //   3. inline  — globalThis["__DSH_BOOT__"] = {...}
  //   4. module  — the Web Shell entry, which CONSUMES the facade
  // 0.1.0's frontend installed the facade itself; 0.1.1 only consumes it and
  // dies with "bootstrap facade is missing" when nobody ran script 1. The
  // renderer builds its own document, so main has to hand these across.
  const html = [
    "<html><head>",
    '<script>window.__ModuleLoader__={mode:"queue"}</script>',
    '<script src="/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=a"></script>',
    `<script>globalThis["__DSH_BOOT__"] = ${JSON.stringify({ rev: "r", entries: [] })}</script>`,
    '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
    "</head></html>",
  ].join("");
  const shell = extractDshShellAssets(html, "http://127.0.0.1:43123");
  assert.deepEqual(shell.bootstrap, ['window.__ModuleLoader__={mode:"queue"}']);
  // The classic src script is a plugin-bundle preload, not the module entry.
  // create() refuses to run when it was skipped, so it must be carried too.
  assert.deepEqual(shell.preload, [
    "http://127.0.0.1:43123/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=a",
  ]);
  assert.deepEqual(shell.scripts, [
    "http://127.0.0.1:43123/assets/index-abc.js",
  ]);
});

test("keeps native DSH client HMR in the desktop boot graph", () => {
  const graphHtml = (entries) =>
    `<script>globalThis["__DSH_BOOT__"] = ${JSON.stringify({ rev: "r", entries })}</script>`;
  const hmr = {
    id: "@deepseek-ai/dsh-client-hmr",
    url: "/plugins/@deepseek-ai/dsh-client-hmr/client.js?rev=a",
    rev: "a",
    immediately: true,
  };
  const shell = {
    id: "@amiba/dsh-plugin-ui-shell",
    url: "/plugins/@amiba/dsh-plugin-ui-shell/client.js?rev=b",
    rev: "b",
  };
  // Ordinary plugins must retain native HMR in both HTTP and file renderers.
  assert.deepEqual(
    extractDshClientBootGraph(graphHtml([hmr, shell]), "http://127.0.0.1:43123")
      .entries.map((entry) => entry.id),
    ["@deepseek-ai/dsh-client-hmr", "@amiba/dsh-plugin-ui-shell"],
  );
  // Never remove it from under an entry that injects it, which would strand
  // that entry waiting on a service instead.
  const dependent = { ...shell, inject: ["@deepseek-ai/dsh-client-hmr"] };
  assert.deepEqual(
    extractDshClientBootGraph(
      graphHtml([hmr, dependent]),
      "http://127.0.0.1:43123",
    ).entries.map((entry) => entry.id),
    ["@deepseek-ai/dsh-client-hmr", "@amiba/dsh-plugin-ui-shell"],
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


test("native download handoff preserves query and rejects other authorities or endpoints", () => {
  const base = "http://127.0.0.1:8080";
  assert.equal(resolveDshSessionDownloadUrl("/api/session.export?sessionId=s&includeDescendants=true",base).href, base+"/api/session.export?sessionId=s&includeDescendants=true");
  for (const url of ["http://127.0.0.1:9090/api/session.export", "https://remote.example/api/session.export", "/api/settings.describe", "/api/session.export/extra", "file:///api/session.export", "http://user:password@127.0.0.1:8080/api/session.export"]) {
    assert.throws(() => resolveDshSessionDownloadUrl(url,base));
  }
});
