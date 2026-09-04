import { describe, expect, it, vi } from "vitest";

import {
  AMIBA_SESSION_ARGUMENT_KEY,
  AmibaRuntimeGatewayClient,
  registerNativeTools,
  supportedInputSchema,
} from "./bridge.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyz-1234567890";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function harness(registerFailure?: string) {
  const definitions = new Map<string, Record<string, unknown>>();
  const validateImage = vi.fn(async () => undefined);
  const saveImage = vi.fn(async (input: { data: Uint8Array; mediaType: string }) => ({
    attachmentId: "att-1",
    mediaType: input.mediaType,
    bytes: input.data.byteLength,
    width: 1,
    height: 1,
  }));
  const ctx = {
    tools: {
      register(definition: Record<string, unknown>) {
        const name = String(definition.name);
        if (name === registerFailure) throw new Error("foreign registration conflict");
        if (definitions.has(name)) throw new Error(`duplicate ${name}`);
        definitions.set(name, definition);
        return () => definitions.delete(name);
      },
    },
    attachments: {
      imageLimits: {
        maxImageBytes: 10_000,
        maxImagesPerMessage: 4,
        maxMessageImageBytes: 20_000,
        maxImagePixels: 10_000,
        mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      },
      validateImage,
      saveImage,
    },
  };
  return { ctx, definitions, validateImage, saveImage };
}

function catalog(...tools: Array<Record<string, unknown>>) {
  return { tools } as never;
}

const SOURCE = {
  kind: "dsh-plugin",
  id: "test-native-plugin",
  name: "Test Native Plugin",
  packageName: "@amiba/dsh-plugin-test-native",
  loadMode: "plugin",
  executionTarget: "desktop-service",
  dynamic: false,
} as const;

describe("Amiba DSH runtime gateway", () => {
  it("accepts only schemas already supported by DSH", () => {
    expect(
      supportedInputSchema({
        type: "object",
        properties: {
          amount: { type: "number", default: 600 },
        },
        required: ["amount"],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: { amount: { type: "number", default: 600 } },
      required: ["amount"],
      additionalProperties: false,
    });
  });

  it("rejects non-loopback or unauthenticated gateway configuration", () => {
    expect(() => new AmibaRuntimeGatewayClient({ url: "https://example.com", token: TOKEN })).toThrow(
      /127\.0\.0\.1/u,
    );
    expect(() => new AmibaRuntimeGatewayClient({ url: "http://127.0.0.1:4000", token: "short" })).toThrow(
      /token/u,
    );
  });

  it("carries the calling session to Electron under the reserved argument key", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ ok: true, result: { content: [] } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AmibaRuntimeGatewayClient({ url: "http://127.0.0.1:4000", token: TOKEN });
    const signal = new AbortController().signal;

    // The gateway wire has no context channel, so the owning session rides
    // along as a reserved argument key that Electron strips before the
    // operation ever sees its arguments.
    await client.call("amiba_browser_open", { url: "https://example.com" }, signal, {
      sessionId: "session-background",
    });
    expect(bodies.at(-1)).toEqual({
      name: "amiba_browser_open",
      arguments: {
        url: "https://example.com",
        [AMIBA_SESSION_ARGUMENT_KEY]: "session-background",
      },
    });

    // A session-less call must not invent the key.
    await client.call("amiba_browser_open", { url: "https://example.com" }, signal);
    expect(bodies.at(-1)).toEqual({
      name: "amiba_browser_open",
      arguments: { url: "https://example.com" },
    });
    await client.call("amiba_browser_open", { url: "https://example.com" }, signal, {});
    expect(bodies.at(-1)).toEqual({
      name: "amiba_browser_open",
      arguments: { url: "https://example.com" },
    });
    vi.unstubAllGlobals();
  });

  it("calls Electron while exposing the stable DSH-owned tool name", async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
      expect(JSON.parse(String(init?.body))).toEqual({
        name: "amiba_browser_open",
        arguments: { url: "https://example.com" },
      });
      return jsonResponse({
        ok: true,
        result: { content: [{ type: "text", text: "Browser opened." }] },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AmibaRuntimeGatewayClient({ url: "http://127.0.0.1:4000", token: TOKEN });
    const { ctx, definitions } = harness();
    registerNativeTools(
      ctx as never,
      client,
      catalog({
        name: "amiba_browser_open",
        description: "Open the visible browser",
        inputSchema: { type: "object", properties: {} },
      }),
      new Map(),
      undefined,
      SOURCE,
    );
    const definition = definitions.get("amiba_browser_open") as {
      execute(args: unknown, exec: unknown): Promise<unknown>;
    };
    await expect(
      definition.execute(
        { url: "https://example.com" },
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ content: [{ type: "text", text: "Browser opened." }] });
    vi.unstubAllGlobals();
  });

  it("publishes native images through DSH's durable attachment service", async () => {
    const png = Buffer.from("fake-png-bytes").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          result: {
            content: [
              { type: "text", text: "Visible browser screenshot" },
              { type: "image", data: png, mimeType: "image/png" },
            ],
          },
        }),
      ),
    );
    const client = new AmibaRuntimeGatewayClient({ url: "http://127.0.0.1:4000", token: TOKEN });
    const { ctx, definitions, validateImage, saveImage } = harness();
    registerNativeTools(
      ctx as never,
      client,
      catalog({
        name: "amiba_browser_screenshot",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      }),
      new Map(),
      undefined,
      SOURCE,
    );
    const definition = definitions.get("amiba_browser_screenshot") as {
      execute(args: unknown, exec: unknown): Promise<Record<string, unknown>>;
      output: { render(args: unknown, value: unknown): unknown };
    };
    const value = await definition.execute({}, { signal: new AbortController().signal });
    expect(validateImage).toHaveBeenCalledOnce();
    expect(saveImage).toHaveBeenCalledOnce();
    expect(definition.output.render({}, value)).toEqual([
      { type: "text", text: "Visible browser screenshot" },
      {
        type: "image",
        attachment: {
          attachmentId: "att-1",
          mediaType: "image/png",
          bytes: 14,
          width: 1,
          height: 1,
        },
      },
    ]);
    vi.unstubAllGlobals();
  });

  it("rolls back the whole new generation on a DSH registry conflict", () => {
    const client = new AmibaRuntimeGatewayClient({ url: "http://127.0.0.1:4000", token: TOKEN });
    const { ctx, definitions } = harness("second");
    expect(() =>
      registerNativeTools(
        ctx as never,
        client,
        catalog(
          { name: "first", inputSchema: { type: "object", properties: {} } },
          { name: "second", inputSchema: { type: "object", properties: {} } },
        ),
        new Map(),
        undefined,
        SOURCE,
      ),
    ).toThrow(/conflict/u);
    expect(definitions.size).toBe(0);
  });
});
