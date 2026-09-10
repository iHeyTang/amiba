import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type {
  ConnectorProvider,
  ConnectorInboundEnvelope,
} from "@amiba/dsh-plugin-connector-core";
import { z } from "zod";

export const name = "amiba-connector-webhook";
export const inject = ["amibaConnectors", "webServer"];
export const WEBHOOK_PATH = "/api/amiba/connectors/webhook";
const MAX_BODY_BYTES = 1024 * 1024;

export interface WebServerFace {
  register(route: {
    kind: "exact";
    path: string;
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
  }): () => void;
}

export const webhookConfigSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{32,}$/u),
    outboundUrl: z.string().default(""),
    allowedSenders: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();
const settingsPatchSchema = z
  .object({
    token: webhookConfigSchema.shape.token.optional(),
    outboundUrl: z.string().optional(),
    allowedSenders: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();
const inboundSchema = z
  .object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    sender: z.string().trim().min(1).optional(),
    conversation: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (
    req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  )
    throw new Error("content_type");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_body");
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** HTTP and public credentials belong to this provider, not the message hub. */
export function createWebhookProvider(
  server: WebServerFace,
): ConnectorProvider {
  return {
    id: "webhook",
    name: "Webhook",
    description: "Connect a custom service using authenticated HTTP messages.",
    messaging: { ownerPairing: false },
    configSchema: webhookConfigSchema,
    async validate(input) {
      const config = webhookConfigSchema.parse(input);
      if (!config.outboundUrl) return;
      const url = new URL(config.outboundUrl);
      const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      if (
        url.username ||
        url.password ||
        (url.protocol !== "https:" && !(local && url.protocol === "http:"))
      )
        throw new Error("outbound_url_requires_https");
    },
    settings(input) {
      const { outboundUrl, allowedSenders } = webhookConfigSchema.parse(input);
      return { outboundUrl, allowedSenders };
    },
    configure(input, patch) {
      return webhookConfigSchema.parse({
        ...webhookConfigSchema.parse(input),
        ...settingsPatchSchema.parse(patch),
      });
    },
    capabilities: () => [],
    async start(handle) {
      const config = webhookConfigSchema.parse(handle.config);
      const expectedToken = digest(config.token);
      const dispose = server.register({
        kind: "exact",
        path: `${WEBHOOK_PATH}/${encodeURIComponent(handle.connectId)}`,
        async handler(req, res) {
          if (req.method !== "POST") {
            res.setHeader("allow", "POST");
            json(res, 405, { ok: false, error: "method_not_allowed" });
            return;
          }
          const supplied =
            req.headers.authorization?.match(/^Bearer (\S+)$/u)?.[1] ?? "";
          if (!timingSafeEqual(digest(supplied), expectedToken)) {
            json(res, 401, { ok: false, error: "unauthorized" });
            return;
          }
          try {
            const parsed = inboundSchema.safeParse(await readBody(req));
            if (!parsed.success) throw new Error("invalid_body");
            const { conversation, ...body } = parsed.data;
            if (
              config.allowedSenders.length &&
              !config.allowedSenders.includes(body.sender ?? "")
            )
              throw new Error("sender_not_allowed");
            const envelope: ConnectorInboundEnvelope = {
              ...body,
              conversation: {
                key: conversation ?? body.sender ?? "default",
                kind: "p2p",
              },
            };
            const result = await handle.onInbound(envelope);
            if (!result) {
              json(res, 503, { ok: false, error: "connection_unavailable" });
              return;
            }
            json(res, result.duplicate ? 200 : 202, {
              ok: true,
              value: result,
            });
          } catch (error) {
            const code =
              error instanceof Error ? error.message : "internal_error";
            const statuses: Record<string, number> = {
              sender_not_allowed: 403,
              content_type: 415,
              body_too_large: 413,
              invalid_body: 400,
            };
            // Runtime failures are retryable. Do not expose internal errors or
            // credentials to a caller, or acknowledge a message we did not queue.
            json(res, statuses[code] ?? 503, {
              ok: false,
              error: statuses[code] ? code : "connection_unavailable",
            });
          }
        },
      });
      handle.setStatus({ state: "ready" });
      return {
        async stop() {
          dispose();
        },
        async deliver(conversation, envelope) {
          if (!config.outboundUrl) return;
          const response = await fetch(config.outboundUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "user-agent": "amiba-connector-webhook/1",
            },
            body: JSON.stringify({
              id: envelope.id,
              connectId: handle.connectId,
              conversation: conversation.key,
              inReplyTo: envelope.inReplyTo,
              text: envelope.text,
              createdAt: envelope.createdAt,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error(`outbound_http_${response.status}`);
        },
      };
    },
  };
}

export function apply(ctx: Context): void {
  const server = (ctx as Context & { webServer: WebServerFace }).webServer;
  ctx.effect(() =>
    ctx.amibaConnectors.registerProvider(createWebhookProvider(server)),
  );
}
