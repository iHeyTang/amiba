import { randomBytes } from "node:crypto";
import http from "node:http";

const MAX_REQUEST_BYTES = 1024 * 1024;

/**
 * One privileged operation implemented by Electron main.
 *
 * The operation name is not a tool declaration. Model-facing names, schemas,
 * descriptions, provenance and lifecycle remain owned by the calling DSH
 * plugin. Electron only performs the narrow native action after authentication.
 */
export interface DshNativeOperation {
  name: string;
  call(
    argumentsValue: Record<string, unknown>,
    context: DshNativeCallContext,
  ): Promise<unknown> | unknown;
}

/**
 * Reserved argument key naming the chat session a call belongs to.
 *
 * The gateway wire is `{ name, arguments }` and has no context channel, so
 * `@amiba/dsh-plugin-runtime-gateway` puts the session in the arguments under
 * this key. The router below lifts it out; no operation declares it, and it
 * appears in no published input schema, so no model can set it.
 */
export const SESSION_ARGUMENT_KEY = "amibaSessionId";

/** Who a native call belongs to; absent for calls with no agent behind them. */
export interface DshNativeCallContext {
  sessionId?: string;
}

export interface DshNativeGateway {
  url: string;
  token: string;
  stop(): Promise<void>;
}

export interface DshNativeOperationRouter {
  call(name: string, argumentsValue: unknown): Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("request body is too large");
    chunks.push(bytes);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(
  response: http.ServerResponse,
  status: number,
  value: unknown,
): void {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

/** Start the authenticated, loopback-only native execution surface for DSH. */
export function createDshNativeOperationRouter(
  operations: readonly DshNativeOperation[],
): DshNativeOperationRouter {
  const operationMap = new Map<string, DshNativeOperation>();
  for (const operation of operations) {
    if (!operation.name || operationMap.has(operation.name)) {
      throw new Error(`Duplicate or empty DSH native operation: ${operation.name}`);
    }
    operationMap.set(operation.name, operation);
  }
  return {
    async call(name, argumentsValue) {
      const operation = operationMap.get(name);
      if (!operation) throw new Error(`Unknown native operation: ${name}`);
      const { [SESSION_ARGUMENT_KEY]: session, ...args } =
        record(argumentsValue);
      return operation.call(args, {
        sessionId: typeof session === "string" && session ? session : undefined,
      });
    },
  };
}

/** Start the authenticated, loopback-only native execution surface for DSH. */
export async function startDshNativeGateway(
  operations: readonly DshNativeOperation[],
): Promise<DshNativeGateway> {
  const router = createDshNativeOperationRouter(operations);

  const token = randomBytes(32).toString("hex");
  const server = http.createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { ok: false, error: "Unauthorized" });
      return;
    }
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/call") {
        const body = record(await readJsonBody(request));
        const name = requiredString(body, "name");
        const result = await router.call(name, body.arguments);
        json(response, 200, { ok: true, result });
        return;
      }
      json(response, 404, { ok: false, error: "Not Found" });
    } catch (error) {
      json(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("DSH native gateway has no TCP address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
