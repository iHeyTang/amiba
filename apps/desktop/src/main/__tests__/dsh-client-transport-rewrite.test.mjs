import assert from "node:assert/strict";
import { test } from "node:test";

import { rewriteSocketUrl } from "../../renderer/dsh-client-transport.ts";

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
