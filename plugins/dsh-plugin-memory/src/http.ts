import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AmibaMemoryStore, AmibaMemoryTarget } from "./memory-store.js";

const ROUTE = "/api/amiba/memory";
const MAX_BODY_BYTES = 32 * 1024;

interface WebServerFace {
  register(route: {
    kind: "exact";
    path: string;
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
  }): () => void;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  if (
    req.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json"
  ) {
    throw new Error("content_type");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(buffer);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid_body");
  }
  return body as Record<string, unknown>;
}

function preset(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("invalid_preset");
  return value.trim();
}

function target(value: unknown): AmibaMemoryTarget | "all" {
  if (value === "memory" || value === "user" || value === "all") return value;
  throw new Error("invalid_target");
}

/** Authenticated human-management face over the same plugin-owned store. */
export function applyMemoryHttp(
  ctx: Context,
  config: { apiToken: string },
  store: AmibaMemoryStore,
): void {
  if (!config.apiToken || config.apiToken.length < 32) {
    throw new Error(
      "amiba memory API token must contain at least 32 characters",
    );
  }
  const server = (ctx as Context & { webServer: WebServerFace }).webServer;
  ctx.effect(
    () =>
      server.register({
        kind: "exact",
        path: ROUTE,
        async handler(req, res) {
          if (req.headers["x-amiba-plugin-token"] !== config.apiToken) {
            json(res, 401, { ok: false, error: "unauthorized" });
            return;
          }
          try {
            if (req.method === "GET") {
              const url = new URL(req.url ?? ROUTE, "http://127.0.0.1");
              json(res, 200, {
                ok: true,
                value: await store.read(preset(url.searchParams.get("preset"))),
              });
              return;
            }
            if (req.method !== "DELETE") {
              res.setHeader("allow", "GET, DELETE");
              json(res, 405, { ok: false, error: "method_not_allowed" });
              return;
            }
            const body = await readBody(req);
            json(res, 200, {
              ok: true,
              value: await store.reset(
                preset(body.preset),
                target(body.target),
              ),
            });
          } catch (error) {
            const code =
              error instanceof Error ? error.message : "internal_error";
            const status =
              code === "content_type"
                ? 415
                : code === "body_too_large"
                  ? 413
                  : 400;
            json(res, status, { ok: false, error: code });
          }
        },
      }),
    "amiba-memory:http",
  );
}
