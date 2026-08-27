import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CommandRuntime } from "@deepseek-ai/dsh-commands";
import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";

const ROUTE = "/api/amiba/commands";
const MAX_BODY_BYTES = 32 * 1024;

export interface CommandsHttpConfig {
  apiToken: string;
}

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

function authorized(req: IncomingMessage, token: string): boolean {
  const supplied = req.headers["x-amiba-plugin-token"];
  return typeof supplied === "string" && supplied === token;
}

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
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
  return value as Record<string, unknown>;
}

function liveAgent(ctx: Context, sessionId: unknown): Agent | undefined {
  const normalized = typeof sessionId === "string" ? sessionId.trim() : "";
  return normalized ? ctx.agents.get(normalized as never) : undefined;
}

/** Expose DSH's exact, scoped human-command catalog to the desktop composer. */
export function applyCommandsHttp(
  ctx: Context,
  config: CommandsHttpConfig,
): void {
  if (!config.apiToken || config.apiToken.length < 32) {
    throw new Error(
      "amiba commands API token must contain at least 32 characters",
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
          if (req.method !== "GET" && req.method !== "POST") {
            res.setHeader("allow", "GET, POST");
            json(res, 405, { ok: false, error: "method_not_allowed" });
            return;
          }
          try {
            if (req.method === "GET") {
              const url = new URL(req.url ?? ROUTE, "http://127.0.0.1");
              const sessionId = url.searchParams.get("sessionId");
              const agent = liveAgent(ctx, sessionId);
              if (!agent) {
                json(res, 409, { ok: false, error: "session_not_live" });
                return;
              }
              const descriptors = await Promise.resolve(
                (ctx as Context & { commands: CommandRuntime }).commands.list(
                  agent,
                ),
              );
              const commands = descriptors.map((command) => ({
                name: command.name,
                description: command.description,
                ...(command.input?.hint
                  ? { inputHint: command.input.hint }
                  : {}),
              }));
              json(res, 200, { ok: true, value: commands });
              return;
            }

            const body = await readBody(req);
            const agent = liveAgent(ctx, body.sessionId);
            if (!agent) {
              json(res, 409, { ok: false, error: "session_not_live" });
              return;
            }
            if (typeof body.line !== "string" || !body.line.trim()) {
              json(res, 400, { ok: false, error: "invalid_line" });
              return;
            }
            const execution = await (
              ctx as Context & { commands: CommandRuntime }
            ).commands.execute(
              agent,
              body.line,
              // DSH 0.1.1 inserted composer image attachments before the
              // signal. This endpoint takes a command line over HTTP and has
              // no attachment channel, so it carries none rather than
              // inventing one.
              [],
              AbortSignal.timeout(5 * 60_000),
            );
            json(res, 200, { ok: true, value: execution ?? null });
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
    "amiba-commands-adapter:http",
  );
}
