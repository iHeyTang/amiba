/**
 * Runtime-host worker entry — the `utilityProcess` child that owns the chat
 * engine.
 *
 * The engine, its DSH client (HTTP + WebSocket) and every streamed frame live
 * here, on this process's own event loop, instead of on the browser process's.
 * The main process keeps window subscriptions, routing and the two services the
 * worker borrows (workspace resolution, draft serialization).
 */

import { DshApiClient, DshChatEngineClient } from "@amiba/app-runtime/dsh-client";
import type { AgentSubagentAddress } from "@amiba/app-runtime/platform";
import type { DshPromptContentPart } from "@amiba/app-runtime/dsh-client";
import NodeWebSocket from "ws";

import type { WorkerPort } from "./worker-protocol";
import { createEngineWorkerRuntime, type WorkerEngineHost } from "./worker-runtime";

/** Electron's child side of a `utilityProcess` link. */
interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort })
  .parentPort;
if (!parentPort)
  throw new Error(
    "The chat engine worker must run inside a utilityProcess (see chat-engine-host.ts).",
  );

const port: WorkerPort = {
  postMessage: (message) => parentPort.postMessage(message),
  // Electron delivers `MessageEvent`s on the child's parent port.
  on: (_event, listener) =>
    parentPort.on("message", (event) => listener(event.data)),
};

createEngineWorkerRuntime({
  port,
  createEngine: (host: WorkerEngineHost, connection) => {
    const cookie = connection.browserCookie;
    // Same connection shape the main process uses: the session cookie rides on
    // both the HTTP requests and the WebSocket handshake.
    const client = new DshApiClient({
      baseUrl: connection.baseUrl,
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        if (cookie) headers.set("cookie", cookie);
        return fetch(url, { ...init, headers });
      },
      createWebSocket: (url) =>
        new NodeWebSocket(url, {
          headers: cookie ? { Cookie: cookie } : {},
        }),
    });
    const engine = new DshChatEngineClient({
      client,
      // Pushed by main (the engine reads addresses synchronously).
      resolveSubagent: (sessionId) =>
        host.subagentAddress(sessionId) as AgentSubagentAddress | undefined,
      resolveSession: async (payload) =>
        (await host.request({
          kind: "resolveSession",
          sessionId: payload.sessionId,
        })) as { cwd?: string; workspaceId?: string },
      selectModel: async (sessionId, selection, signal) => {
        await client.selectModel({ sessionId, ...selection }, signal);
      },
      // The draft registry is renderer-local; the engine asks the submitting
      // window through main. `put`/`remove` belong to the renderer's own flow.
      attachments: {
        serialize: async (sessionId, ids) =>
          (await host.request({
            kind: "serializeDrafts",
            sessionId,
            ids: [...ids],
          })) as DshPromptContentPart[],
        put: async () => {
          throw new Error(
            "Attachment uploads are handled by the renderer draft registry.",
          );
        },
        remove: async () => {
          throw new Error(
            "Attachment removal is handled by the renderer draft registry.",
          );
        },
      },
      sessionActivity: (sessionId) => host.sessionActivity(sessionId),
    });
    engine.onSnapshot((frame) => {
      if (frame.type !== "snapshot") return;
      host.emitFrame(frame);
    });
    engine.onStreamEvent((sessionId, event) => {
      host.emitFrame({ type: "event", sessionId, event });
    });
    return engine;
  },
});
