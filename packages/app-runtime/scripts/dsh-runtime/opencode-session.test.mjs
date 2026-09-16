import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { existsSync } from "node:fs";
import path from "node:path";

const requireRuntime = createRequire(
  new URL("../../package.json", import.meta.url),
);
const requireHeadless = createRequire(
  requireRuntime.resolve("@deepseek-ai/dsh-headless"),
);
const adapterPath = requireHeadless.resolve("@deepseek-ai/dsh-llm-pi-ai");
const requireAdapter = createRequire(adapterPath);
const piRoot = requireAdapter.resolve
  .paths("@earendil-works/pi-ai")
  .map((p) => path.join(p, "@earendil-works/pi-ai"))
  .find((p) => existsSync(path.join(p, "package.json")));
const { PiAiAdapter } = await import(pathToFileURL(adapterPath));

// Exercise the installed, patched adapter and real SDK HTTP clients. The local
// server ends requests with a deliberate 400 so no provider credentials are used.
async function fixture(
  t,
  api,
  provider = "opencode-go",
  headers = {},
  baseUrl,
) {
  const requests = [];
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* drain request */
    }
    requests.push(req.headers);
    res.writeHead(400, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { type: "invalid_request_error", message: "wire-test-stop" },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { streamSimple } = await import(
    pathToFileURL(path.join(piRoot, `dist/api/${api}.js`))
  );
  const localURL = `http://127.0.0.1:${server.address().port}/v1`;
  const model = {
    id: "test-model",
    name: "Test",
    provider,
    api,
    baseUrl: baseUrl ?? localURL,
    input: ["text"],
    reasoning: false,
    contextWindow: 8192,
    maxTokens: 64,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const profile = {
    headers,
    modelErrors: new Map(),
    configuredMaxTokens: new Map(),
    streamIdleTimeoutMs: 5000,
  };
  const profiles = new Map([[provider, profile]]);
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => "test-key",
  });
  adapter.snapshot = {
    profiles,
    models: {
      getModel: () => model,
      streamSimple: (model, context, options) =>
        streamSimple({ ...model, baseUrl: localURL }, context, options),
    },
  };
  async function send(sessionId, prepared = false) {
    const before = requests.length;
    const options = {
      provider,
      model: model.id,
      sessionId,
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    const stream = prepared
      ? (await adapter.prepareCall(provider, model.id)).stream(options)
      : adapter.stream(options);
    for await (const _ of stream) {
      /* consume the real HTTP request */
    }
    assert.equal(
      requests.length,
      before + 1,
      "each SDK call must send exactly one HTTP request",
    );
    return requests.at(-1);
  }
  return { send, model, requests, headers };
}

for (const api of [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
]) {
  test(`${api}: stable conversation headers across repeated and prepared calls`, async (t) => {
    const { send, requests } = await fixture(t, api);
    for (const prepared of [false, true, false]) {
      assert.equal(
        (await send("conversation-a", prepared))["x-opencode-session"],
        "conversation-a",
      );
    }
    assert.equal(
      (await send("conversation-b"))["x-opencode-session"],
      "conversation-b",
    );
    assert.equal(requests.length, 4);
    assert.ok(
      requests.every(
        (r) => r["user-agent"] && !r["user-agent"].startsWith("OpenAI/"),
      ),
    );
  });
}

test("OpenCode Zen overrides case-insensitive static session headers without mutating profile", async (t) => {
  const headers = {
    "X-OpenCode-Session": "static-id",
    "x-extra-header": "keep",
  };
  const { send } = await fixture(t, "openai-completions", "opencode", headers);
  const result = await send("actual-session");
  assert.equal(result["x-opencode-session"], "actual-session");
  assert.equal(result["x-extra-header"], "keep");
  assert.equal(headers["X-OpenCode-Session"], "static-id");
});

test("unrelated providers do not receive an OpenCode session header", async (t) => {
  const { send } = await fixture(t, "openai-completions", "custom-provider");
  assert.equal((await send("conversation-a"))["x-opencode-session"], undefined);
});

test("calls without a session preserve explicit headers and do not invent an ID", async (t) => {
  const { send, headers } = await fixture(t, "openai-completions");
  assert.equal((await send(undefined))["x-opencode-session"], undefined);
  headers["X-OpenCode-Session"] = "explicit-session";
  assert.equal(
    (await send(undefined))["x-opencode-session"],
    "explicit-session",
  );
});

for (const [baseUrl, expected] of [
  ["https://opencode.ai/zen/go/v1", "conversation-a"],
  ["https://opencode.ai/zen/v1", "conversation-a"],
  ["https://opencode.ai.example.com/v1", undefined],
  ["https://example.com/opencode.ai", undefined],
  ["invalid-url", undefined],
]) {
  test(`custom provider URL detection: ${baseUrl}`, async (t) => {
    const { send } = await fixture(
      t,
      "openai-completions",
      "custom-provider",
      {},
      baseUrl,
    );
    assert.equal(
      (await send("conversation-a"))["x-opencode-session"],
      expected,
    );
  });
}
