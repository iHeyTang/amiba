import type { JsonValue } from "@deepseek-ai/dsh-util-values";
import type { Context } from "@deepseek-ai/cordis";
import type { ImageMediaType } from "@deepseek-ai/dsh-attachment";
import {
  assertObjectJsonSchema,
  type JsonSchemaNode,
  type ToolDefinition,
} from "@deepseek-ai/dsh-tools";
import type {
  ToolProvenanceRegistry,
  ToolSourceDescriptor,
} from "@amiba/dsh-plugin-catalog";

const CALL_TIMEOUT_MS = 120_000;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u;
const IMAGE_MEDIA_TYPES = new Set<ImageMediaType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * Reserved argument key carrying the session a native call belongs to.
 *
 * The gateway wire is `{ name, arguments }` and has no context channel, so
 * the owning session travels as one reserved key inside `arguments`. The
 * desktop main process strips it in its operation router before an operation
 * ever sees its arguments — no native operation declares it, and no model
 * can set it (it is not in any published input schema).
 */
export const AMIBA_SESSION_ARGUMENT_KEY = "amibaSessionId";

/** Who a native call belongs to; absent for calls with no agent behind them. */
export interface RuntimeGatewayCallContext {
  sessionId?: string;
}

export interface RuntimeGatewayConfig {
  url: string;
  token: string;
}

export interface RuntimeGatewayTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface RuntimeGatewayToolSet {
  tools: RuntimeGatewayTool[];
}

interface CanonicalGatewayResult {
  content: JsonValue[];
  structuredContent?: JsonValue;
}

export type ToolDisposers = Map<string, () => void>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return undefined;
  }
}

function validateRuntimeGatewayOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Amiba runtime gateway must be an authenticated 127.0.0.1 HTTP origin",
    );
  }
  return url;
}

export function supportedInputSchema(
  value: unknown,
): JsonSchemaNode & { type: "object" } {
  assertObjectJsonSchema(value);
  return value;
}

function gatewayText(value: JsonValue[], toolName: string): string {
  const parts: string[] = [];
  for (const item of value) {
    const block = record(item);
    if (!block) {
      parts.push(JSON.stringify(item));
      continue;
    }
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "image") {
      parts.push("[image attached]");
    } else {
      parts.push(JSON.stringify(block));
    }
  }
  return parts.join("\n") || `(${toolName} returned no text content)`;
}

function renderedContent(value: JsonValue[], toolName: string) {
  const output: Array<
    | { type: "text"; text: string }
    | { type: "image"; attachment: Record<string, JsonValue> }
  > = [];
  for (const item of value) {
    const block = record(item);
    if (block?.type === "text" && typeof block.text === "string") {
      output.push({ type: "text", text: block.text });
      continue;
    }
    const attachment = record(block?.attachment);
    if (
      block?.type === "image" &&
      attachment &&
      typeof attachment.attachmentId === "string" &&
      typeof attachment.mediaType === "string"
    ) {
      output.push({
        type: "image",
        attachment: attachment as Record<string, JsonValue>,
      });
      continue;
    }
    output.push({ type: "text", text: JSON.stringify(item) });
  }
  return output.length
    ? output
    : [{ type: "text" as const, text: `(${toolName} returned no content)` }];
}

function decodeCanonicalBase64(data: string): Uint8Array {
  const bytes = Buffer.from(data, "base64");
  if (!data || bytes.toString("base64") !== data) {
    throw new Error("Native operation returned invalid image base64");
  }
  return new Uint8Array(bytes);
}

async function normalizeRuntimeGatewayResult(
  ctx: Context,
  raw: unknown,
  toolName: string,
): Promise<CanonicalGatewayResult> {
  const source = record(raw);
  if (source?.isError === true) {
    const content = Array.isArray(source.content)
      ? ((jsonValue(source.content) as JsonValue[] | undefined) ?? [])
      : [];
    throw new Error(gatewayText(content, toolName));
  }
  const rawContent = Array.isArray(source?.content)
    ? source.content
    : [
        {
          type: "text",
          text:
            jsonValue(raw) === undefined ? "(no output)" : JSON.stringify(raw),
        },
      ];

  const prepared = rawContent.map((item) => {
    const block = record(item);
    if (block?.type !== "image")
      return { kind: "json" as const, value: jsonValue(item) };
    if (typeof block.data !== "string" || typeof block.mimeType !== "string") {
      return { kind: "json" as const, value: jsonValue(item) };
    }
    if (!IMAGE_MEDIA_TYPES.has(block.mimeType as ImageMediaType)) {
      return {
        kind: "json" as const,
        value: {
          type: "text",
          text: `[unsupported image type: ${block.mimeType}]`,
        } as JsonValue,
      };
    }
    return {
      kind: "image" as const,
      data: decodeCanonicalBase64(block.data),
      mediaType: block.mimeType as ImageMediaType,
    };
  });

  const images = prepared.filter((item) => item.kind === "image");
  const limits = ctx.attachments.imageLimits;
  if (images.length > limits.maxImagesPerMessage) {
    throw new Error(
      `Native operation returned more than ${limits.maxImagesPerMessage} images`,
    );
  }
  if (
    images.reduce((sum, image) => sum + image.data.byteLength, 0) >
    limits.maxMessageImageBytes
  ) {
    throw new Error(
      "Native operation image output exceeds DSH's aggregate image limit",
    );
  }
  for (const image of images) {
    await ctx.attachments.validateImage({
      data: image.data,
      mediaType: image.mediaType,
    });
  }

  const content: JsonValue[] = [];
  for (const item of prepared) {
    if (item.kind === "json") {
      if (item.value !== undefined) content.push(item.value);
      continue;
    }
    const attachment = await ctx.attachments.saveImage({
      data: item.data,
      mediaType: item.mediaType,
    });
    content.push({ type: "image", attachment } as unknown as JsonValue);
  }
  const structuredContent = jsonValue(source?.structuredContent);
  return {
    content,
    ...(structuredContent === undefined ? {} : { structuredContent }),
  };
}

export class AmibaRuntimeGatewayClient {
  readonly origin: URL;

  constructor(readonly config: RuntimeGatewayConfig) {
    this.origin = validateRuntimeGatewayOrigin(config.url);
    if (config.token.length < 32)
      throw new Error("Amiba runtime gateway token is invalid");
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(new URL(path, this.origin), {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${this.config.token}`,
      },
    });
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(
        String(
          record(body)?.error ??
            `Runtime gateway returned HTTP ${response.status}`,
        ),
      );
    }
    return body;
  }

  async call(
    name: string,
    args: unknown,
    signal: AbortSignal,
    context?: RuntimeGatewayCallContext,
  ): Promise<unknown> {
    const argumentsValue = { ...(record(args) ?? {}) };
    if (context?.sessionId) {
      argumentsValue[AMIBA_SESSION_ARGUMENT_KEY] = context.sessionId;
    }
    const response = await this.request("/call", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, arguments: argumentsValue }),
    });
    const source = record(response);
    if (source?.ok !== true || !("result" in (source ?? {}))) {
      throw new Error("Runtime gateway returned an invalid call result");
    }
    return source.result;
  }
}

function definitionFor(
  ctx: Context,
  client: AmibaRuntimeGatewayClient,
  source: RuntimeGatewayTool,
): ToolDefinition {
  if (!TOOL_NAME.test(source.name)) {
    throw new Error(`Invalid DSH native tool name: ${source.name}`);
  }
  return {
    name: source.name,
    description: source.description ?? "",
    parameters: supportedInputSchema(source.inputSchema) as unknown as Record<
      string,
      unknown
    >,
    timeoutMs: CALL_TIMEOUT_MS,
    output: {
      schema: {
        type: "object",
        properties: {
          content: { type: "array", items: {} },
          structuredContent: {},
        },
        required: ["content"],
        additionalProperties: false,
      },
      render: (_args, value) => {
        const content = record(value)?.content;
        return renderedContent(
          Array.isArray(content) ? content : [],
          source.name,
        ) as never;
      },
    },
    async execute(args, exec) {
      return normalizeRuntimeGatewayResult(
        ctx,
        await client.call(source.name, args, exec.signal),
        source.name,
      );
    },
  };
}

export function registerNativeTools(
  ctx: Context,
  client: AmibaRuntimeGatewayClient,
  toolSet: RuntimeGatewayToolSet,
  previous: ToolDisposers,
  provenance?: ToolProvenanceRegistry,
  ownerSource?: ToolSourceDescriptor,
): ToolDisposers {
  const definitions = new Map<
    string,
    { definition: ToolDefinition; source: ToolSourceDescriptor }
  >();
  if (!ownerSource) {
    throw new Error("A DSH plugin owner is required for native gateway tools");
  }
  for (const source of toolSet.tools) {
    const definition = definitionFor(ctx, client, source);
    if (definitions.has(definition.name)) {
      throw new Error(
        `DSH plugin contains duplicate native tool ${definition.name}`,
      );
    }
    definitions.set(definition.name, {
      definition,
      source: ownerSource,
    });
  }

  for (const dispose of previous.values()) dispose();
  const next: ToolDisposers = new Map();
  try {
    for (const [name, entry] of definitions) {
      const unregisterTool = ctx.tools.register(entry.definition);
      try {
        const unregisterSource = provenance?.register(name, entry.source);
        next.set(name, () => {
          unregisterSource?.();
          unregisterTool();
        });
      } catch (error) {
        unregisterTool();
        throw error;
      }
    }
    return next;
  } catch (error) {
    for (const dispose of next.values()) dispose();
    throw error;
  }
}
