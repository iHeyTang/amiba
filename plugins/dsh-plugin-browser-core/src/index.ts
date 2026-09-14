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
const IMAGE_MEDIA_TYPES = new Set<ImageMediaType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * Who a browser operation belongs to.
 *
 * A background task session drives the same tools as the session on screen,
 * so every call carries its owning session. Without it the visible workbench
 * is the only place a provider can put a tab, and a task the user is not
 * looking at hijacks the conversation they ARE looking at.
 *
 * `sessionId` is absent for calls that have no agent behind them (the user
 * clicking "open browser"); those keep the provider's global behaviour.
 */
export interface BrowserCallContext {
  sessionId?: string;
}

export interface BrowserProvider {
  id: string;
  name: string;
  priority?: number;
  call(
    operation: BrowserOperation,
    argumentsValue: Record<string, unknown>,
    signal: AbortSignal,
    context: BrowserCallContext,
  ): Promise<unknown>;
}

export type BrowserOperation =
  | "amiba_browser_open"
  | "amiba_browser_snapshot"
  | "amiba_browser_click"
  | "amiba_browser_type"
  | "amiba_browser_press"
  | "amiba_browser_scroll"
  | "amiba_browser_screenshot"
  | "amiba_browser_console";

interface BrowserTool {
  name: BrowserOperation;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface CanonicalResult {
  content: JsonValue[];
  structuredContent?: JsonValue;
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

const TOOLS: readonly BrowserTool[] = [
  {
    name: "amiba_browser_open",
    description:
      "Open a URL in the active Amiba browser provider. Use it for previews and interactive verification.",
    inputSchema: objectSchema(
      {
        url: {
          type: "string",
          description: "URL, localhost address, or search query.",
        },
      },
      ["url"],
    ),
  },
  {
    name: "amiba_browser_snapshot",
    description:
      "Read the current browser page as text plus interactive element refs. Call this before clicking or typing.",
    inputSchema: objectSchema({}),
  },
  {
    name: "amiba_browser_click",
    description:
      "Click an element using a snapshot ref, CSS selector, or visible text.",
    inputSchema: objectSchema(
      { target: { type: "string", description: "Snapshot ref, CSS selector, or visible text." } },
      ["target"],
    ),
  },
  {
    name: "amiba_browser_type",
    description: "Fill an input or editable browser element.",
    inputSchema: objectSchema(
      {
        target: { type: "string" },
        text: { type: "string" },
        submit: { type: "boolean", default: false },
      },
      ["target", "text"],
    ),
  },
  {
    name: "amiba_browser_press",
    description: "Press a keyboard key in the currently focused browser element.",
    inputSchema: objectSchema(
      { key: { type: "string", description: "Key or modifier combination." } },
      ["key"],
    ),
  },
  {
    name: "amiba_browser_scroll",
    description: "Scroll the current browser page.",
    inputSchema: objectSchema({
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        default: "down",
      },
      amount: { type: "number", default: 600 },
    }),
  },
  {
    name: "amiba_browser_screenshot",
    description: "Capture the current browser viewport for visual verification.",
    inputSchema: objectSchema({}),
  },
  {
    name: "amiba_browser_console",
    description: "Read recent JavaScript console messages from the browser.",
    inputSchema: objectSchema({ clear: { type: "boolean", default: false } }),
  },
];

const SOURCE: ToolSourceDescriptor = {
  kind: "dsh-plugin",
  distribution: "builtin",
  id: "amiba-browser-core",
  name: "Amiba Browser",
  packageName: "@amiba/dsh-plugin-browser-core",
  loadMode: "plugin",
  executionTarget: "external-process",
  dynamic: true,
};

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

function decodeCanonicalBase64(data: string): Uint8Array {
  const bytes = Buffer.from(data, "base64");
  if (!data || bytes.toString("base64") !== data) {
    throw new Error("Browser provider returned invalid image base64");
  }
  return new Uint8Array(bytes);
}

async function normalizeResult(
  ctx: Context,
  raw: unknown,
  operation: BrowserOperation,
): Promise<CanonicalResult> {
  const source = record(raw);
  const rawContent = Array.isArray(source?.content)
    ? source.content
    : [{ type: "text", text: jsonValue(raw) === undefined ? "(no output)" : JSON.stringify(raw) }];
  if (source?.isError === true) {
    const message = rawContent
      .map((item) => record(item)?.text)
      .filter((item): item is string => typeof item === "string")
      .join("\n");
    throw new Error(message || `${operation} failed`);
  }

  const prepared = rawContent.map((item) => {
    const block = record(item);
    if (block?.type !== "image" || typeof block.data !== "string" || typeof block.mimeType !== "string") {
      return { kind: "json" as const, value: jsonValue(item) };
    }
    if (!IMAGE_MEDIA_TYPES.has(block.mimeType as ImageMediaType)) {
      return {
        kind: "json" as const,
        value: { type: "text", text: `[unsupported image type: ${block.mimeType}]` } as JsonValue,
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
    throw new Error("Browser provider returned too many images");
  }
  if (images.reduce((sum, image) => sum + image.data.byteLength, 0) > limits.maxMessageImageBytes) {
    throw new Error("Browser provider image output exceeds DSH limits");
  }
  for (const image of images) {
    await ctx.attachments.validateImage({ data: image.data, mediaType: image.mediaType });
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

function renderedContent(value: unknown, operation: BrowserOperation) {
  const content = record(value)?.content;
  const output: Array<
    | { type: "text"; text: string }
    | { type: "image"; attachment: Record<string, JsonValue> }
  > = [];
  for (const item of Array.isArray(content) ? content : []) {
    const block = record(item);
    if (block?.type === "text" && typeof block.text === "string") {
      output.push({ type: "text", text: block.text });
    } else if (block?.type === "image" && record(block.attachment)) {
      output.push({
        type: "image",
        attachment: record(block.attachment) as Record<string, JsonValue>,
      });
    }
  }
  return output.length
    ? output
    : [{ type: "text" as const, text: `(${operation} returned no content)` }];
}

function supportedInputSchema(value: unknown): JsonSchemaNode & { type: "object" } {
  assertObjectJsonSchema(value);
  return value;
}

export class AmibaBrowserService {
  private readonly providers = new Map<string, BrowserProvider>();
  private readonly toolDisposers = new Map<string, () => void>();

  constructor(
    private readonly ctx: Context,
    private readonly provenance?: ToolProvenanceRegistry,
  ) {}

  listProviders(): ReadonlyArray<Pick<BrowserProvider, "id" | "name" | "priority">> {
    return this.sortedProviders().map(({ id, name, priority }) => ({ id, name, priority }));
  }

  registerProvider(provider: BrowserProvider): () => void {
    if (!provider.id.trim()) throw new Error("Browser provider id is required");
    if (this.providers.has(provider.id)) {
      throw new Error(`Duplicate browser provider: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    this.ensureTools();
    return () => {
      if (this.providers.get(provider.id) !== provider) return;
      this.providers.delete(provider.id);
      if (!this.providers.size) this.disposeTools();
    };
  }

  dispose(): void {
    this.providers.clear();
    this.disposeTools();
  }

  private sortedProviders(): BrowserProvider[] {
    return [...this.providers.values()].sort(
      (left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id),
    );
  }

  private activeProvider(): BrowserProvider {
    const provider = this.sortedProviders()[0];
    if (!provider) throw new Error("No Amiba browser provider is available");
    return provider;
  }

  private ensureTools(): void {
    if (this.toolDisposers.size) return;
    try {
      for (const tool of TOOLS) {
        const definition: ToolDefinition = {
          name: tool.name,
          description: tool.description,
          parameters: supportedInputSchema(tool.inputSchema) as unknown as Record<string, unknown>,
          timeoutMs: CALL_TIMEOUT_MS,
          output: {
            schema: {
              type: "object",
              properties: { content: { type: "array", items: {} }, structuredContent: {} },
              required: ["content"],
              additionalProperties: false,
            },
            render: (_args, value) => renderedContent(value, tool.name) as never,
          },
          execute: async (args, exec) =>
            normalizeResult(
              this.ctx,
              await this.activeProvider().call(
                tool.name,
                record(args) ?? {},
                exec.signal,
                { sessionId: exec.agent?.session.id },
              ),
              tool.name,
            ),
        };
        const unregisterTool = this.ctx.tools.register(definition);
        try {
          const unregisterSource = this.provenance?.register(tool.name, SOURCE);
          this.toolDisposers.set(tool.name, () => {
            unregisterSource?.();
            unregisterTool();
          });
        } catch (error) {
          unregisterTool();
          throw error;
        }
      }
    } catch (error) {
      this.disposeTools();
      throw error;
    }
  }

  private disposeTools(): void {
    for (const dispose of this.toolDisposers.values()) dispose();
    this.toolDisposers.clear();
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaBrowser: AmibaBrowserService;
  }
}

export const name = "amiba-browser-core";
export const inject = ["tools", "attachments", "amibaToolCatalog"];

export function apply(ctx: Context): void {
  const service = new AmibaBrowserService(ctx, ctx.amibaToolCatalog);
  ctx.provide("amibaBrowser", service);
  ctx.effect(() => () => service.dispose(), "amiba-browser-core");
}
