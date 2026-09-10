/** Real MemOS Core/SQLite + official DSH hooks; deterministic model fixtures.
 * No user data, model downloads or paid model calls. This checks integration,
 * persistence, full-mode scoring plumbing and namespace isolation, not model
 * quality. Host LLM fixtures return known summaries/reflection/reward scores.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(process.env.AMIBA_MEMORY_TEST_APP || import.meta.url);
const { resolveRetryPolicy } = await import(pathToFileURL(require.resolve("@deepseek-ai/dsh-llm")));
const memos = await import(pathToFileURL(require.resolve(
  "@memtensor/memos-local-plugin/dist/adapters/deepseek-harness/index.js",
)));
const home = await mkdtemp(path.join(tmpdir(), "amiba-memos-smoke-"));
process.env.MEMOS_HOME = home;
process.env.MEMOS_CONFIG_FILE = path.join(home, "config.yaml");
const fixture = createServer(async (request, response) => {
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { input } = JSON.parse(body);
    const inputs = Array.isArray(input) ? input : [input];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: inputs.map((_, index) => ({
      index, embedding: Array.from({ length: 1536 }, (_, i) => i === 0 ? 1 : 0),
    })) }));
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
let dispose;
const hooks = new Map();
const tools = new Map();
const messages = [];
let modelCalls = 0;
const ctx = {
  logger: { warn: (s) => messages.push(s), info: (s) => messages.push(s) },
  llm: {
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    prepareCall: async (config) => ({ config, adapterDefaults: {},
      retryPolicy: resolveRetryPolicy(undefined, "fixture"),
      stream: async function* () {
        modelCalls += 1;
        const text = JSON.stringify({ summary: fact, alpha: 0.95, usable: true,
          reason: "fixture", kind: "task", relation: "new_task", confidence: 1,
          goal_achievement: 1, process_quality: 1, user_satisfaction: 1, label: "success",
          scores: [{ idx: 0, reflection_text: fact, alpha: 0.95, usable: true, reason: "fixture" }],
        });
        yield { type: "block-start", index: 0, blockType: "text" };
        yield { type: "text-delta", index: 0, text };
        yield { type: "block-end", index: 0, block: { type: "text", text } };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    }),
  },
  systemPrompt: { section: () => () => {} },
  tools: { register: (tool) => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
  on: (name, fn) => { hooks.set(name, fn); return () => hooks.delete(name); },
};
const fact = "Amiba project uses pnpm and the release branch is amber-orchid.";
const session = (id, preset = "standard") => ({ id, header: { agentPreset: preset, cwd: home }, requestHeader: () => ({ config: { provider: "fixture", model: "fixture" } }) });
const signal = AbortSignal.timeout(30_000);
const beforeStep = (s, text) => hooks.get("agent/pre-step")({
  agent: { id: s.id, session: s, options: {} }, turn: 1, step: 1, signal,
}, async () => ({ kind: "enter", messages: [{
  id: "fixture-user", role: "user", source: { kind: "user" },
  content: [{ type: "text", text }],
}] }));
try {
  await writeFile(path.join(home, "config.yaml"), `algorithm:
  lightweightMemory:
    enabled: false
  retrieval:
    llmFilterEnabled: false
  l2Induction:
    minEpisodesForInduction: 2
llm:
  provider: host
telemetry:
  enabled: false
embedding:
  provider: openai_compatible
  endpoint: http://127.0.0.1:${fixture.address().port}/v1
  model: text-embedding-3-small
  apiKey: fixture
`);
  const config = memos.Config({ home, viewerEnabled: false, hostLlmEnabled: true,
    failOnStartupError: true, recallTimeoutMs: 5000 });
  dispose = await memos.apply(ctx, config);
  assert.deepEqual([...tools.keys()].sort(), ["memos_search", "memos_get", "memos_timeline",
    "memos_environment", "memos_skill_list", "memos_skill_get"].sort());
  const first = session("capture-session");
  await beforeStep(first, fact);
  const event = (type, data) => hooks.get("session/event")(first, { type, data, time: Date.now() });
  event("assistant/message", { turn: 1, message: { content: [{ type: "text", text: fact }] } });
  event("turn/end", { turn: 1, reason: "stop" });
  await dispose();
  dispose = undefined;
  assert.ok(messages.some((s) => s.includes("capture session=capture-session")), messages.join("\n"));

  // Reopen the actual database, then recall in a new DSH session.
  dispose = await memos.apply(ctx, config);
  const recalled = await beforeStep(session("new-session"), "What is the amber-orchid release branch?");
  assert.ok(recalled.messages.some((m) => m.source?.kind === "plugin"
    && JSON.stringify(m).includes("amber-orchid")), JSON.stringify({ recalled, messages }));
  const isolated = await beforeStep(session("isolated-session", "other-preset"), "amber-orchid");
  assert.equal(isolated.messages.filter((m) => m.source?.kind === "plugin").length, 0);
  const result = await tools.get("memos_search").execute({ query: "amber-orchid" }, {
    agent: { id: "tool-session", session: session("tool-session") }, signal,
  });
  assert.ok(result.hits.length > 0);
  assert.ok(modelCalls > 0, "full-mode processing did not call the host LLM bridge");
  console.log("PASS: full-mode fixture Core, six tools, automatic capture, restart persistence, cross-session recall, preset isolation, search tool");
} finally {
  await dispose?.();
  await new Promise((resolve) => fixture.close(resolve));
  await rm(home, { recursive: true, force: true });
}
