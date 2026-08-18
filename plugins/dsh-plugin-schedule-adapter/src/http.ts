import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";

import { DshScheduleManager } from "./manager.js";

const ROUTE = "/api/amiba/schedules";
const MAX_BODY_BYTES = 32 * 1024;

export interface ScheduleHttpConfig {
  apiToken: string;
}

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

function authorized(req: IncomingMessage, token: string): boolean {
  const supplied = req.headers["x-amiba-plugin-token"];
  return typeof supplied === "string" && supplied === token;
}

async function readBody(req: IncomingMessage): Promise<JsonRecord> {
  const contentType = req.headers["content-type"]
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
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
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_body");
  }
  return value as JsonRecord;
}

/** Register the authenticated loopback management face for DSH Schedule. */
export function applyScheduleHttp(
  ctx: Context,
  config: ScheduleHttpConfig,
  manager = new DshScheduleManager(ctx),
): void {
  if (!config.apiToken || config.apiToken.length < 32) {
    throw new Error(
      "amiba schedule API token must contain at least 32 characters",
    );
  }
  const server = (ctx as Context & { webServer: WebServerFace }).webServer;
  ctx.effect(
    () =>
      server.register({
        kind: "exact",
        path: ROUTE,
        async handler(req: IncomingMessage, res: ServerResponse) {
          if (!authorized(req, config.apiToken)) {
            json(res, 401, { ok: false, error: "unauthorized" });
            return;
          }
          try {
            if (req.method === "GET") {
              const url = new URL(req.url ?? ROUTE, "http://127.0.0.1");
              const sessionId = url.searchParams.get("sessionId");
              json(res, 200, {
                ok: true,
                sessionId,
                value: await manager.list(sessionId ?? ""),
              });
              return;
            }

            if (req.method !== "POST" && req.method !== "DELETE") {
              res.setHeader("allow", "GET, POST, DELETE");
              json(res, 405, { ok: false, error: "method_not_allowed" });
              return;
            }

            const body = await readBody(req);
            json(res, 200, {
              ok: true,
              sessionId: String(body.sessionId),
              value:
                req.method === "DELETE"
                  ? await manager.remove(
                      String(body.sessionId ?? ""),
                      String(body.id ?? ""),
                    )
                  : await manager.create(String(body.sessionId ?? ""), {
                      prompt: String(body.prompt ?? ""),
                      ...(body.afterSeconds === undefined
                        ? {}
                        : { afterSeconds: Number(body.afterSeconds) }),
                      ...(body.everySeconds === undefined
                        ? {}
                        : { everySeconds: Number(body.everySeconds) }),
                      ...(body.at === undefined ? {} : { at: body.at as never }),
                    }),
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
    "amiba-schedule-adapter:http",
  );
}
