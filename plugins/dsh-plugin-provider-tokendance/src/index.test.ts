import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { TokenDanceAdapter } from "./adapter.js";
import { MessageId, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import {
  InMemoryCredentialStore,
  defaultProviderAuthContext,
} from "@earendil-works/pi-ai";
import {
  ProfileConfig as Config,
  resolveProfile,
  endpoint,
  PROVIDER,
} from "./index.js";
import { parseCatalog } from "./catalog.js";

const config = (input: Partial<Config> = {}) =>
  Config({ ...Config(), ...input });
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
const catalog = parseCatalog({
  data: [
    {
      id: "chat-model",
      supported_protocols: ["openai:chat-completions"],
      context_length: 4000,
      description: "A model for careful code review.",
    },
    { id: "response-model", supported_protocols: ["openai:responses"] },
    { id: "claude-model", supported_protocols: ["anthropic:messages"] },
    { id: "kimi-k3", supported_protocols: ["openai:chat-completions", "openai:responses"] },
    { id: "deepseek-v4-flash-0731", supported_protocols: ["openai:chat-completions", "openai:responses"] },
    { id: "video-model", supported_protocols: ["minimax:video_generation_v2"] },
  ],
});
describe("official TokenDance provider", () => {
  it("filters non-chat models and learns protocols from the directory, not model names", () => {
    expect(catalog.map((m) => m.api)).toEqual([
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
      "openai-completions",
      "openai-completions",
    ]);
    expect(catalog[0]?.contextWindow).toBe(4000);
    expect(catalog[0]?.description).toBe("A model for careful code review.");
    expect(catalog.every((m) => m.input === undefined)).toBe(true);
  });
  it("normalizes gateway roots without doubling SDK endpoint paths", () => {
    expect(
      endpoint("https://tokendance.space/gateway/v1/", "openai-responses"),
    ).toBe("https://tokendance.space/gateway/v1");
    expect(
      endpoint("https://tokendance.space/gateway", "anthropic-messages"),
    ).toBe("https://tokendance.space/gateway");
  });
  it("refuses mismatched protocol declarations and duplicate model IDs", () => {
    expect(() =>
      resolveProfile(
        config({ models: [{ id: "chat-model", api: "anthropic-messages" }] }),
        catalog,
      ),
    ).toThrow("does not advertise");
    expect(() =>
      resolveProfile(
        config({ models: [{ id: "chat-model" }, { id: "chat-model" }] }),
        catalog,
      ),
    ).toThrow("duplicate");
    expect(() =>
      resolveProfile(config({ models: [{ id: "unlisted" }] }), catalog),
    ).toThrow("Choose a protocol");
  });
  it("keeps all protocols under one official provider ID and resolves exact model metadata", async () => {
    const profile = resolveProfile(config({ refreshCatalog: false }), catalog);
    const adapter = new TokenDanceAdapter({
      profiles: () => new Map([[PROVIDER, profile]]),
      resolveApiKey: async () => "test-key",
      auth: {
        credentials: new InMemoryCredentialStore(),
        authContext: defaultProviderAuthContext(),
      },
    }, (_, id) => catalog.find(row => row.id === id)?.description);
    expect((await adapter.listModels(PROVIDER)).map((m) => m.provider)).toEqual(
      ["tokendance", "tokendance", "tokendance", "tokendance", "tokendance"],
    );
    expect(await adapter.resolveModel(PROVIDER, "chat-model")).toMatchObject({
      context: { contextWindow: 4000 },
      description: catalog[0]!.description,
    });
    expect((await adapter.listModels(PROVIDER))[0]?.description).toBe(catalog[0]!.description);
    expect((await adapter.prepareCall(PROVIDER, "chat-model")).model.description).toBe(catalog[0]!.description);
  });
  it("publishes exact supported efforts and respects model/protocol overrides", async () => {
    async function models(overrides: Partial<Config> = {}) {
      const profile = resolveProfile(config(overrides), catalog);
      const adapter = new TokenDanceAdapter({
        profiles: () => new Map([[PROVIDER, profile]]),
        resolveApiKey: async () => "test-key",
        auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
      }, () => undefined);
      return Promise.all((await adapter.listModels(PROVIDER)).map(m => adapter.resolveModel(PROVIDER, m.id)));
    }
    const defaults = await models();
    expect(defaults.find(m => m.id === "kimi-k3")?.reasoning?.efforts.map(e => e.id))
      .toEqual(["low", "high", "max"]);
    expect(defaults.find(m => m.id === "deepseek-v4-flash-0731")?.reasoning?.efforts.map(e => e.id))
      .toEqual(["off", "high"]);
    expect(defaults.find(m => m.id === "chat-model")?.reasoning).toBeUndefined();
    expect((await models({ models: [{ id: "kimi-k3", reasoningEfforts: false }] }))[0]?.reasoning)
      .toBeUndefined();
    expect((await models({ models: [{ id: "kimi-k3", api: "openai-responses" }] }))[0]?.reasoning)
      .toBeUndefined();
    expect((await models({ models: [{ id: "kimi-k3", reasoningEfforts: { high: "high" } }] }))[0]?.reasoning?.efforts.map(e => e.id))
      .toEqual(["high"]);
    expect((await models({ models: [{ id: "kimi-k3" }] }))[0]?.reasoning?.efforts.map(e => e.id))
      .toEqual(["low", "high", "max"]);
  });
  it.each([
    ["chat-model", undefined], ["response-model", undefined],
    ["claude-model", undefined], ["tool-call", undefined],
    ["kimi-k3", "low"], ["kimi-k3", "high"], ["kimi-k3", "max"],
    ["deepseek-v4-flash-0731", "off"], ["deepseek-v4-flash-0731", "high"],
  ])(
    "dispatches %s through official streaming adapters with authentication",
    async (scenario, effort) => {
      const model = scenario === "tool-call" ? "chat-model" : scenario;
      const requests: Array<{ path: string; body: any; headers: any }> = [];
      const server = createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        requests.push({
          path: req.url!,
          body: JSON.parse(body),
          headers: req.headers,
        });
        res.writeHead(200, { "content-type": "text/event-stream" });
        const event = (type: string, data: object) =>
          res.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
          );
        if (req.url === "/gateway/v1/messages") {
          event("message_start", {
            message: {
              id: "msg_1",
              type: "message",
              role: "assistant",
              model,
              content: [],
              stop_reason: null,
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          });
          event("content_block_start", {
            index: 0,
            content_block: { type: "text", text: "" },
          });
          event("content_block_delta", {
            index: 0,
            delta: { type: "text_delta", text: "hello" },
          });
          event("content_block_stop", { index: 0 });
          event("message_delta", {
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 1 },
          });
          event("message_stop", {});
        } else if (req.url === "/gateway/v1/responses") {
          event("response.created", {
            response: {
              id: "resp_1",
              model,
              status: "in_progress",
              output: [],
            },
          });
          event("response.output_item.added", {
            output_index: 0,
            item: {
              id: "item_1",
              type: "message",
              role: "assistant",
              content: [],
              status: "in_progress",
            },
          });
          event("response.content_part.added", {
            item_id: "item_1",
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
          event("response.output_text.delta", {
            item_id: "item_1",
            output_index: 0,
            content_index: 0,
            delta: "hello",
          });
          event("response.output_item.done", {
            output_index: 0,
            item: {
              id: "item_1",
              type: "message",
              role: "assistant",
              content: [
                { type: "output_text", text: "hello", annotations: [] },
              ],
              status: "completed",
            },
          });
          event("response.completed", {
            response: {
              id: "resp_1",
              model,
              status: "completed",
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
              output: [],
            },
          });
        } else if (scenario === "tool-call") {
          res.write(
            `data: ${JSON.stringify({ id: "chat_tool", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"test"}' } }] }, finish_reason: null }] })}\n\n`,
          );
          res.write(
            `data: ${JSON.stringify({ id: "chat_tool", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
          );
          res.write("data: [DONE]\n\n");
        } else {
          res.write(
            `data: ${JSON.stringify({ id: "chat_1", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }] })}\n\n`,
          );
          res.write(
            `data: ${JSON.stringify({ id: "chat_1", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
          );
          res.write("data: [DONE]\n\n");
        }
        res.end();
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const port = (server.address() as { port: number }).port;
      const profile = resolveProfile(
        config({
          baseURL: `http://127.0.0.1:${port}/gateway`,
          refreshCatalog: false,
        }),
        catalog,
      );
      const adapter = new PiAiAdapter({
        profiles: () => new Map([[PROVIDER, profile]]),
        resolveApiKey: async () => "test-key",
        auth: {
          credentials: new InMemoryCredentialStore(),
          authContext: defaultProviderAuthContext(),
        },
      });
      const chunks = [];
      for await (const chunk of adapter.stream({
        provider: PROVIDER,
        model,
        ...(effort ? { reasoningEffort: ReasoningEffortId(effort) } : {}),
        tools: [
          {
            name: "lookup",
            description: "Look up a value",
            parameters: {
              type: "object",
              properties: { q: { type: "string" } },
              required: ["q"],
            },
          },
        ],
        messages: [
          {
            id: MessageId("user_1"),
            role: "user",
            source: { kind: "user" },
            content: [{ type: "text", text: "Hi" }],
          },
        ],
        signal: AbortSignal.timeout(10000),
      }))
        chunks.push(chunk);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.path).toBe(
        (model === "chat-model" || model === "kimi-k3")
          ? "/gateway/v1/chat/completions"
          : (model === "response-model" || model === "deepseek-v4-flash-0731")
            ? "/gateway/v1/responses"
            : "/gateway/v1/messages",
      );
      expect(requests[0]?.body.model).toBe(model);
      if (model === "kimi-k3") {
        expect(requests[0]?.body.reasoning_effort).toBe(effort);
        expect(requests[0]?.body.thinking).toBeUndefined();
      }
      if (model === "deepseek-v4-flash-0731") {
        expect(requests[0]?.body.reasoning.effort).toBe(effort === "off" ? "none" : "high");
      }
      expect(
        requests[0]?.headers.authorization ?? requests[0]?.headers["x-api-key"],
      ).toMatch(/test-key/);
      expect(JSON.stringify(chunks)).toContain(
        scenario === "tool-call" ? "lookup" : "hello",
      );
      expect(requests[0]?.body.tools).toHaveLength(1);
      if (scenario === "tool-call")
        expect(JSON.stringify(chunks)).toContain("test");
      expect(chunks.at(-1)).toMatchObject({ type: "finish" });
    },
  );
});
