/**
 * Main-process chat engine host.
 *
 * Hosts the app's ONE `DshChatEngineClient` (the device's single set of DSH
 * runtime connections for run state, session journals and interaction
 * waits) and exposes it to every window through the protocol's
 * `ChatEngineClient` shape over IPC (`chat-engine:*` / preload
 * `window.amiba.chatEngine`).
 *
 * Windows are pure views: they subscribe to the sessions they render, the
 * host follows that session's durable journal in the shared engine (so live
 * turns stream to EVERY viewer, including turns no window in this process
 * submitted), and routed `EngineToClientMessage` pushes come back over IPC.
 * Closing a window only removes its subscriptions — the engine's run state
 * survives, so a conversation keeps progressing while every window is
 * closed, and a reopened window re-attaches to live state.
 */

import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain, type WebContents } from "electron";
import {
  DshApiClient,
  DshChatEngineClient,
  type DshPromptContentPart,
} from "@amiba/app-runtime/dsh-client";
import {
  retainedAddress,
  resolveSessionCreationWorkspaceWith,
  type AgentSubagentAddress,
} from "@amiba/app-runtime/platform";
import type {
  ApprovalDecision,
  ApprovalRequest,
  EngineToClientMessage,
  RuntimeActionResult,
  SubmitPayload,
  SubmitReceipt,
  UserQuestionAnswerItem,
  UserQuestionRequest,
} from "@amiba/app-runtime/protocol";
import { mainStore } from "./storage";
import { workspaceManager } from "./workspace";
import { createFrameBatcher, type FrameBatcher } from "./frame-batcher";
import { dshRuntimeClient, sessionIndex } from "./session-index";
import { dshRuntime } from "./dsh-runtime";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  spawnEngineWorker,
  type EngineWorkerHandle,
  type HostedEngine,
} from "./chat-engine/worker-engine-facade";
import { ChatEngineRouter } from "./chat-engine/router";

/** Storage key the renderer sessions runtime keeps subagent addresses under. */
const LOCAL_META_KEY = "sessions.local-meta";

function contentsOf(id: number): WebContents | null {
  for (const win of BrowserWindow.getAllWindows()) {
    const contents = win.webContents;
    if (contents.id === id) return contents;
  }
  return null;
}

export class ChatEngineHost {
  /** Built next to the main bundle by the same electron-vite build. */
  private static readonly directory = path.dirname(fileURLToPath(import.meta.url));
  private engine: HostedEngine | null = null;
  /** The runtime host process; `engine` is its facade. */
  private worker: EngineWorkerHandle | null = null;
  private offSessions: (() => void) | undefined;
  private started = false;
  private registered = false;
  /** Pure window-subscription ledger (electrode-independent, unit-tested). */
  private readonly router = new ChatEngineRouter();
  private readonly pendingSerializes = new Map<
    string,
    (response: {
      requestId: string;
      ok: boolean;
      parts?: DshPromptContentPart[];
      error?: string;
    }) => void
  >();
  private addressBySession = new Map<string, AgentSubagentAddress>();
  private metaWatchOff: (() => void) | undefined;
  /**
   * Per-window frame buffers. One runtime frame used to become one IPC message
   * per subscriber; during streaming that is a structured clone and a renderer
   * wake-up per delta, on the process that owns the window event loop. Frames
   * are now delivered once per tick, in order.
   */
  private readonly frameBatches = new Map<
    number,
    FrameBatcher<EngineToClientMessage>
  >();

  /** Start the host and register its IPC surface. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.refreshSubagentMeta();
    this.metaWatchOff = mainStore.watch(() => this.refreshSubagentMeta());
    // Session facts are the ONE `session/list` poll shared by the state layer,
    // the activity tracker and the engine. The worker cannot reach that index,
    // so every change is pushed to it.
    this.offSessions = sessionIndex.onChange((rows) => {
      const bridge = this.worker?.bridge;
      if (!bridge) return;
      for (const row of rows)
        bridge.notifyActivity(row.sessionId, row.running);
      // Parent relationships appear as subagents spawn; the worker's map has to
      // keep up because the engine reads it synchronously.
      bridge.notifySubagents(this.subagentAddressMap());
    });
    this.registerIpc();
  }

  /** Teardown for app quit. */
  dispose(): void {
    this.started = false;
    this.offSessions?.();
    this.offSessions = undefined;
    this.metaWatchOff?.();
    this.metaWatchOff = undefined;
    this.router.clear();
    this.pendingSerializes.clear();
    for (const batcher of this.frameBatches.values()) batcher.dispose();
    this.frameBatches.clear();
    this.engine?.dispose();
    this.engine = null;
    this.worker?.kill();
    this.worker = null;
  }

  private client(): Promise<DshApiClient> {
    return dshRuntimeClient();
  }

  // ---------------------------------------------------------------------
  // IPC surface
  // ---------------------------------------------------------------------

  private registerIpc(): void {
    if (this.registered) return;
    this.registered = true;

    ipcMain.handle(
      "chat-engine:subscribe",
      (event, sessionId: unknown, subagent: unknown) => {
        if (typeof sessionId !== "string" || !sessionId) return;
        this.subscribe(
          event.sender.id,
          sessionId,
          subagent as AgentSubagentAddress | undefined,
        );
      },
    );
    ipcMain.handle("chat-engine:unsubscribe", (event, sessionId: unknown) => {
      if (typeof sessionId !== "string") return;
      this.unsubscribe(event.sender.id, sessionId);
    });
    ipcMain.handle("chat-engine:snapshot", (_event, sessionId: unknown) => {
      if (typeof sessionId !== "string") return;
      void this.withEngine((engine) => engine.requestSnapshot(sessionId));
    });
    ipcMain.handle("chat-engine:submit", (event, payload: SubmitPayload) => {
      if (!payload || typeof payload.sessionId !== "string") return;
      this.router.declareSubmitter(payload.sessionId, event.sender.id);
      void this.withEngine((engine) => engine.submit(payload));
    });
    ipcMain.handle(
      "chat-engine:submit-receipt",
      (event, payload: SubmitPayload) => {
        if (!payload || typeof payload.sessionId !== "string") {
          return {
            kind: "rejected",
            error: "Invalid submit payload.",
          } as SubmitReceipt;
        }
        this.router.declareSubmitter(payload.sessionId, event.sender.id);
        return this.withEngineReceipt((engine) =>
          engine.submitWithReceipt(payload),
        );
      },
    );
    ipcMain.handle("chat-engine:abort", (_event, sessionId: unknown) => {
      if (typeof sessionId !== "string") return;
      void this.withEngine((engine) => engine.abort(sessionId));
    });
    ipcMain.handle("chat-engine:clear", (_event, sessionId: unknown) => {
      if (typeof sessionId !== "string") return;
      void this.withEngine((engine) => engine.clear(sessionId));
    });
    ipcMain.handle(
      "chat-engine:clear-approval",
      (_event, sessionId: unknown, approvalId: unknown) => {
        if (typeof sessionId !== "string" || typeof approvalId !== "string") {
          return;
        }
        void this.withEngine((engine) =>
          engine.clearApproval(sessionId, approvalId),
        );
      },
    );
    ipcMain.handle(
      "chat-engine:respond-approval",
      (_event, request: ApprovalRequest, decision: ApprovalDecision) =>
        this.withEngineResult((engine) =>
          engine.respondToApproval(request, decision),
        ),
    );
    ipcMain.handle(
      "chat-engine:respond-questions",
      (_event, request: UserQuestionRequest, answers: UserQuestionAnswerItem[]) =>
        this.withEngineResult((engine) =>
          engine.respondToQuestions(request, answers),
        ),
    );
    ipcMain.handle(
      "chat-engine:cancel-questions",
      (_event, request: UserQuestionRequest) =>
        this.withEngineResult((engine) => engine.cancelQuestions(request)),
    );
    // Draft serialization: the hosted engine asks the window that submitted
    // the turn to resolve its local draft ids into DSH content parts.
    ipcMain.on(
      "chat-engine:serialize-response",
      (
        _event,
        response: {
          requestId: string;
          ok: boolean;
          parts?: DshPromptContentPart[];
          error?: string;
        },
      ) => {
        const resolve = this.pendingSerializes.get(response.requestId);
        if (!resolve) return;
        this.pendingSerializes.delete(response.requestId);
        resolve(response);
      },
    );
  }

  private async withEngine(
    action: (engine: HostedEngine) => void,
  ): Promise<void> {
    const engine = await this.ensureEngine();
    if (engine) action(engine);
  }

  private async withEngineResult(
    action: (engine: HostedEngine) => Promise<RuntimeActionResult>,
  ): Promise<RuntimeActionResult> {
    const engine = await this.ensureEngine();
    if (!engine) return { ok: false, error: "Chat engine is not ready." };
    return action(engine);
  }

  private async withEngineReceipt(
    action: (engine: HostedEngine) => Promise<SubmitReceipt>,
  ): Promise<SubmitReceipt> {
    const engine = await this.ensureEngine();
    if (!engine) return { kind: "rejected", error: "Chat engine is not ready." };
    return action(engine);
  }

  /**
   * Start the runtime host process and return the facade the rest of this class
   * drives. The engine itself — client, follow streams, every frame — lives in
   * that process, on its own event loop, instead of on the browser process's.
   */
  private async ensureEngine(): Promise<HostedEngine | null> {
    if (this.engine) return this.engine;
    try {
      const handle = await dshRuntime.ensureStarted();
      this.worker = spawnEngineWorker({
        entryPath: path.join(ChatEngineHost.directory, "chat-engine-worker.js"),
        connection: {
          baseUrl: handle.baseUrl,
          ...(handle.browserCookie === undefined
            ? {}
            : { browserCookie: handle.browserCookie }),
        },
        onFrame: (message) => this.route(message.sessionId, message),
        // The two services the worker borrows: the session.create directory
        // policy served by the main workspace manager, and the renderer-local
        // draft registry, which lives in the submitting window.
        handleRequest: (request) =>
          request.kind === "resolveSession"
            ? this.resolveSessionWorkspace(request.sessionId)
            : this.serializeDrafts(request.sessionId, request.ids),
        subagents: () => this.subagentAddressMap(),
        activity: () =>
          sessionIndex
            .getSnapshot()
            .map(
              (row) => [row.sessionId, row.running] as [string, boolean],
            ),
        onError: (error) =>
          console.error("[amiba] chat engine worker failed:", error),
      });
      this.engine = this.worker.engine;
      return this.engine;
    } catch {
      // Runtime not ready yet; a later request retries.
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Subscriptions / routing
  // ---------------------------------------------------------------------

  private subscribe(
    webContentsId: number,
    sessionId: string,
    subagent?: AgentSubagentAddress,
  ): void {
    const first = this.router.subscribe(webContentsId, sessionId, subagent);
    if (!this.engine) {
      // Subscribers race the runtime; attach everything once the engine is
      // live. The snapshot is re-emitted to every listener at that point, so
      // windows that joined while the engine was cold still get their state.
      void this.ensureEngine().then((engine) => {
        if (!engine || !this.router.hasSubscribers(sessionId)) return;
        engine.follow(sessionId, this.router.address(sessionId));
        engine.subscribe(sessionId);
      });
      return;
    }
    // Only the FIRST viewer of a session opens its durable journal follow;
    // `engine.subscribe` stays idempotent and re-emits the current snapshot
    // to every listener, so a later viewer joining a followed session also
    // receives the run state it needs to render.
    if (first) this.engine.follow(sessionId, this.router.address(sessionId));
    this.engine.subscribe(sessionId);
  }

  private unsubscribe(webContentsId: number, sessionId: string): void {
    if (this.router.unsubscribe(webContentsId, sessionId)) {
      this.engine?.unfollow(sessionId);
    }
  }

  private route(sessionId: string, message: EngineToClientMessage): void {
    this.router.route(sessionId, message, (id, msg) => {
      const contents = contentsOf(id);
      if (!contents || contents.isDestroyed()) {
        const stale = this.frameBatches.get(id);
        if (stale) {
          stale.dispose();
          this.frameBatches.delete(id);
        }
        return;
      }
      let batcher = this.frameBatches.get(id);
      if (!batcher) {
        batcher = createFrameBatcher<EngineToClientMessage>((items) => {
          const target = contentsOf(id);
          if (!target || target.isDestroyed()) return;
          try {
            // One message per tick; the preload fans the batch back out to its
            // listeners in order, so the renderer commits once per tick.
            target.send("chat-engine:message", items);
          } catch {
            // A frame can be disposed between the check and the send (window
            // teardown, a dev reload). The batch is dropped, not fatal.
          }
        });
        this.frameBatches.set(id, batcher);
      }
      batcher.push(msg);
    });
  }

  // ---------------------------------------------------------------------
  // Main-side engine options
  // ---------------------------------------------------------------------

  private resolveSubagent(sessionId: string): AgentSubagentAddress | undefined {
    // Synchronous by contract (the engine reads it synchronously). The
    // address caches are kept fresh by the running poller and the mainStore
    // watcher — the same two sources the renderer store derives them from.
    const retained = this.addressBySession.get(sessionId);
    if (retained) return retained;
    const parent = sessionIndex.parent(sessionId);
    if (parent) {
      return {
        parentSessionId: parent,
        childSessionId: sessionId,
        mode: "continuable",
      };
    }
    return undefined;
  }

  /**
   * The engine's synchronous view of durable subagent addresses: the mainStore
   * sidecar plus the session index's parent fallback, resolved here because the
   * worker cannot reach either.
   */
  private subagentAddressMap(): Record<string, AgentSubagentAddress> {
    const addresses: Record<string, AgentSubagentAddress> = {};
    const ids = new Set(this.addressBySession.keys());
    for (const row of sessionIndex.getSnapshot()) ids.add(row.sessionId);
    for (const sessionId of ids) {
      const address = this.resolveSubagent(sessionId);
      if (address) addresses[sessionId] = address;
    }
    return addresses;
  }

  private refreshSubagentMeta(): void {
    void mainStore
      .get(LOCAL_META_KEY)
      .then((meta: Record<string, unknown>) => {
        const sidecar = (meta[LOCAL_META_KEY] ?? {}) as Record<string, unknown>;
        const next = new Map<string, AgentSubagentAddress>();
        for (const [sessionId, value] of Object.entries(sidecar)) {
          const address = retainedAddress(sessionId, value);
          if (address) next.set(sessionId, address);
        }
        this.addressBySession = next;
        // The engine reads addresses synchronously during submit and abort, so
        // the worker gets the whole resolved map rather than asking per call.
        this.worker?.bridge.notifySubagents(this.subagentAddressMap());
      })
      .catch(() => {});
  }

  private async resolveSessionWorkspace(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ cwd?: string; workspaceId?: string }> {
    // The SAME session.create directory policy the renderer surfaces use
    // (`resolveSessionCreationWorkspace`), served by main-process bindings —
    // see packages/app-runtime/src/platform/session-workspace.ts.
    return resolveSessionCreationWorkspaceWith(sessionId, {
      listBindings: () => workspaceManager.listBindings(),
      listSessions: async () =>
        (await this.client()
          .then((client) => client.listSessions(signal))
          .catch(() => ({ items: [] }))).items,
      bindIfUnbound: (id, cwd) => workspaceManager.bindIfUnbound(id, cwd),
      resolveRuntimeCwd: (id, cwd) =>
        workspaceManager.resolveRuntimeCwd(id, cwd),
      getDefaultRoot: () => workspaceManager.getDefaultRoot(),
      createWorkspace: async (cwd) =>
        (await this.client()).createWorkspace(cwd, signal),
    });
  }

  private async serializeDrafts(
    sessionId: string,
    ids: string[],
    signal?: AbortSignal,
  ): Promise<DshPromptContentPart[]> {
    const submitter = this.router.submitter(sessionId);
    const contents = submitter === undefined ? null : contentsOf(submitter);
    if (!contents || contents.isDestroyed()) {
      throw new Error(
        "Attachment drafts are unavailable. Please attach the files again.",
      );
    }
    const requestId = randomUUID();
    const timer = setTimeout(
      () => {
        const resolve = this.pendingSerializes.get(requestId);
        if (!resolve) return;
        this.pendingSerializes.delete(requestId);
        resolve({
          requestId,
          ok: false,
          error: "Attachment serialization timed out.",
        });
      },
      30_000,
    );
    timer.unref?.();
    const onAbort = (): void => {
      const resolve = this.pendingSerializes.get(requestId);
      if (!resolve) return;
      this.pendingSerializes.delete(requestId);
      resolve({
        requestId,
        ok: false,
        error: "Attachment serialization was cancelled.",
      });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const result = await new Promise<{
      requestId: string;
      ok: boolean;
      parts?: DshPromptContentPart[];
      error?: string;
    }>((resolve) => {
      this.pendingSerializes.set(requestId, (response) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(response);
      });
      // The submitting window resolves the drafts; send the request BEFORE
      // awaiting so the round trip can complete.
      contents.send("chat-engine:serialize-request", { requestId, sessionId, ids });
    });
    if (!result.ok) {
      throw new Error(result.error ?? "Attachment serialization failed.");
    }
    return result.parts ?? [];
  }
}

export const chatEngineHost = new ChatEngineHost();