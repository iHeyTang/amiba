import type { Context } from "@deepseek-ai/cordis";
import type {
  InboundMessageEnvelope,
  MessageChannelCenter,
  MessageChannelProvider,
} from "@amiba/dsh-plugin-messaging-core";
import type { IncomingMessage, ServerResponse } from "node:http";

export const name = "amiba-messaging-channel-webhook";
export const inject = ["amibaMessageCenter", "webServer"];

const INBOUND_ROUTE = "/api/amiba/message-inbound";
const MAX_BODY_BYTES = 1024 * 1024;

interface WebServerFace {
  register(route: {
    kind: "exact";
    path: string;
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
  }): () => void;
}

type JsonRecord = Record<string, unknown>;

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function bearer(req: IncomingMessage): string {
  const authorization = req.headers.authorization;
  return typeof authorization === "string" &&
    authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
}

async function readBody(req: IncomingMessage): Promise<JsonRecord> {
  const contentType = req.headers["content-type"]
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") throw new Error("content_type");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_body");
  }
  return value as JsonRecord;
}

function requiredString(body: JsonRecord, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid_${key}`);
  }
  return value.trim();
}

function inboundEnvelope(body: JsonRecord): InboundMessageEnvelope {
  return {
    id: requiredString(body, "id"),
    text: requiredString(body, "text"),
    ...(typeof body.sender === "string" && body.sender.trim()
      ? { sender: body.sender.trim() }
      : {}),
    ...(body.metadata &&
    typeof body.metadata === "object" &&
    !Array.isArray(body.metadata)
      ? { metadata: body.metadata as JsonRecord }
      : {}),
  };
}

function statusFor(code: string): number {
  if (code === "unauthorized") return 401;
  if (code === "channel_not_found") return 404;
  if (code === "sender_not_allowed") return 403;
  if (code === "content_type") return 415;
  if (code === "body_too_large") return 413;
  return 400;
}

export const webhookProvider: MessageChannelProvider = {
  id: "webhook",
  name: "Webhook",
  description:
    "Authenticated JSON ingress with an optional JSON reply callback.",
  supportsInbound: true,
  supportsOutbound: true,
  inboundPath: INBOUND_ROUTE,
  validate(channel) {
    if (!channel.outboundUrl) return;
    const url = new URL(channel.outboundUrl);
    const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      throw new Error("outbound_url_requires_https");
    }
  },
  async deliver(channel, envelope) {
    if (!channel.outboundUrl) return;
    const response = await fetch(channel.outboundUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "amiba-dsh-message-channel-webhook/1",
      },
      body: JSON.stringify(envelope),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`outbound_http_${response.status}`);
  },
};

/** Register one transport provider and its ingress route into the message hub. */
export function apply(ctx: Context): void {
  const runtime = ctx as Context & {
    amibaMessageCenter: MessageChannelCenter;
    webServer: WebServerFace;
  };
  ctx.effect(
    () => runtime.amibaMessageCenter.registerProvider(webhookProvider),
    "amiba-messaging-channel-webhook:provider",
  );
  ctx.effect(
    () =>
      runtime.webServer.register({
        kind: "exact",
        path: INBOUND_ROUTE,
        async handler(req, res) {
          if (req.method !== "POST") {
            res.setHeader("allow", "POST");
            json(res, 405, { ok: false, error: "method_not_allowed" });
            return;
          }
          try {
            const body = await readBody(req);
            const result = await runtime.amibaMessageCenter.acceptInbound(
              requiredString(body, "channelId"),
              bearer(req),
              inboundEnvelope(body),
            );
            json(res, result.duplicate ? 200 : 202, {
              ok: true,
              value: result,
            });
          } catch (error) {
            const code =
              error instanceof Error ? error.message : "internal_error";
            json(res, statusFor(code), { ok: false, error: code });
          }
        },
      }),
    "amiba-messaging-channel-webhook:http",
  );
}
