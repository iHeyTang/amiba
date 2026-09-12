import assert from "node:assert/strict";
import { test } from "node:test";

import {
  installDshClientDevReload,
  parseDshClientRebuildFrame,
  rewriteSocketUrl,
} from "../../renderer/dsh-client-transport.ts";

const RUNTIME = new URL("http://127.0.0.1:64892");

test("dev page-origin events.mux socket rewrites to the runtime authority", () => {
  // Regression: ws:// URLs have a ws-scheme origin, so a naive
  // `target.origin === pageOrigin` comparison never matches the page's
  // http origin — the socket then escaped to the vite dev server and hung
  // in CONNECTING forever (chat stuck on "thinking" with no error).
  const rewritten = rewriteSocketUrl(
    "ws://localhost:5173/api/events.mux",
    RUNTIME,
    "http://localhost:5173",
  );
  assert.equal(rewritten, "ws://127.0.0.1:64892/api/events.mux");
});

test("wss page-origin api socket maps through https origin comparison", () => {
  const rewritten = rewriteSocketUrl(
    "wss://app.example.com/api/events.mux",
    new URL("https://127.0.0.1:64892"),
    "https://app.example.com",
  );
  assert.equal(rewritten, "wss://127.0.0.1:64892/api/events.mux");
});

test("dsh.internal sockets rewrite regardless of page origin", () => {
  const rewritten = rewriteSocketUrl(
    "ws://dsh.internal/api/events.mux",
    RUNTIME,
    "null",
  );
  assert.equal(rewritten, "ws://127.0.0.1:64892/api/events.mux");
});

test("non-api and foreign-origin sockets pass through untouched", () => {
  assert.equal(
    rewriteSocketUrl(
      "ws://localhost:5173/hmr",
      RUNTIME,
      "http://localhost:5173",
    ),
    "ws://localhost:5173/hmr",
  );
  assert.equal(
    rewriteSocketUrl(
      "wss://example.com/api/events.mux",
      RUNTIME,
      "http://localhost:5173",
    ),
    "wss://example.com/api/events.mux",
  );
});

test("accepts only complete client rebuilt frames", () => {
  assert.deepEqual(
    parseDshClientRebuildFrame(
      JSON.stringify({ type: "rebuilt", id: "plugin-a", rev: "next" }),
    ),
    { type: "rebuilt", id: "plugin-a", rev: "next" },
  );
  assert.equal(
    parseDshClientRebuildFrame(JSON.stringify({ type: "graph", graph: {} })),
    null,
  );
  assert.equal(
    parseDshClientRebuildFrame(
      JSON.stringify({ type: "rebuilt", id: "plugin-a" }),
    ),
    null,
  );
  assert.equal(parseDshClientRebuildFrame("not json"), null);
});

for (const protocol of ["http:", "file:"]) test(`${protocol} uses DSH plugin HMR and refreshes only the root owner`, () => {
  const previousWindow = globalThis.window;
  const previousEventSource = globalThis.EventSource;
  let reloads = 0;
  let source;

  class FakeEventSource extends EventTarget {
    closed = false;

    constructor(url) {
      super();
      assert.equal(url, "/plugins/events");
      source = this;
    }

    close() {
      this.closed = true;
    }

    emit(data) {
      const event = new Event("message");
      Object.defineProperty(event, "data", { value: data });
      this.dispatchEvent(event);
    }
  }

  globalThis.window = {
    location: {
      protocol,
      reload: () => {
        reloads += 1;
      },
    },
  };
  globalThis.EventSource = FakeEventSource;
  try {
    const dispose = installDshClientDevReload();
    source.emit(JSON.stringify({ type: "graph", graph: {} }));
    assert.equal(reloads, 0);
    source.emit(
      JSON.stringify({ type: "rebuilt", id: "plugin-a", rev: "next" }),
    );
    source.emit(
      JSON.stringify({ type: "rebuilt", id: "plugin-b", rev: "later" }),
    );
    assert.equal(reloads, 0);
    source.emit(JSON.stringify({ type: "rebuilt", id: "@amiba/dsh-plugin-ui-shell", rev: "root1" }));
    source.emit(JSON.stringify({ type: "rebuilt", id: "@amiba/dsh-plugin-ui-shell", rev: "root2" }));
    assert.equal(reloads, 1);
    assert.equal(source.closed, true);
    dispose();
  } finally {
    globalThis.window = previousWindow;
    globalThis.EventSource = previousEventSource;
  }
});
