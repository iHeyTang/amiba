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
  type DshSessionActivitySource,
} from "@amiba/app-runtime/dsh-client";
import type { AgentSubagentAddress } from "@amiba/app-runtime/platform";
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
import { dshRuntime } from "./dsh-runtime";
import { mainStore } from "./storage";
import { workspaceManager } from "./workspace";

/** Storage key the renderer sessions runtime keeps subagent addresses under. */
const LOCAL_META_KEY = "sessions.local-meta";

function contentsOf(id: number): WebContents | null {
  for (const win of BrowserWindow.getAllWindows()) {
    const contents = win.webContents;
    if (contents.id === id) return contents;
  }
  return null;
}

/** Retained-address semantics identical to the renderer sessions store. */
function retainedAddress(
  sessionId: string,
  value: unknown,
): AgentSubagentAddress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const address = value as Partial<AgentSubagentAddress>;
  if (
    address.childSessionId !== sessionId ||
    typeof address.parentSessionId !== "string" ||
    !address.parentSessionId ||
    address.parentSessionId === sessionId ||
    (address.mode !== "one-shot" && address.mode !== "continuable")
  ) {
    return undefined;
  }
  return {
    parentSessionId: address.parentSessionId,
    childSessionId: sessionId,
    mode: address.mode,
  };
}

export class ChatEngineHost {
  private engine: DshChatEngineClient | null = null;
  private started = false;
  private registered = false;
  /** sessionId → subscribed webContents ids (per-window view routing). */
  private readonly subscribers = new Map<string, Set<number>>();
  private readonly addresses = new Map<string, AgentSubagentAddress>();
  /** sessionId → webContents id of the window that last submitted a turn. */
  private readonly submitters = new Map<string, number>();
  private readonly pendingSerializes = new Map<
    string,
    (response: {
      requestId: string;
      ok: boolean;
      parts?: DshPromptContentPart[];
      error?: string;
    }) => void
  >();
  private readonly activityListeners = new Map<string, Set<() => void>>();
  private runningBySession = new Map<string, boolean>();
  private parentBySession = new Map<string, string>();
  private addressBySession = new Map<string, AgentSubagentAddress>();
  private runningTimer: ReturnType<typeof setInterval> | undefined;
  private metaWatchOff: (() => void) | undefined;

  /** Start the host and register its IPC surface. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.refreshSubagentMeta();
    this.metaWatchOff = mainStore.watch(() => this.refreshSubagentMeta());
    this.registerIpc();
  }

  /** Teardown for app quit. */
  dispose(): void {
    this.started = false;
    this.metaWatchOff?.();
    this.metaWatchOff = undefined;
    if (this.runningTimer) clearInterval(this.runningTimer);
    this.runningTimer = undefined;
    this.activityListeners.clear();
    this.subscribers.clear();
    this.addresses.clear();
    this.submitters.clear();
    this.pendingSerializes.clear();
    this.engine?.dispose();
    this.engine = null;
  }

  private async client(): Promise<DshApiClient> {
    return (await dshRuntime.ensureStarted()).client;
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
      this.submitters.set(payload.sessionId, event.sender.id);
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
        this.submitters.set(payload.sessionId, event.sender.id);
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
    action: (engine: DshChatEngineClient) => void,
  ): Promise<void> {
    const engine = await this.ensureEngine();
    if (engine) action(engine);
  }

  private async withEngineResult(
    action: (engine: DshChatEngineClient) => Promise<RuntimeActionResult>,
  ): Promise<RuntimeActionResult> {
    const engine = await this.ensureEngine();
    if (!engine) return { ok: false, error: "Chat engine is not ready." };
    return action(engine);
  }

  private async withEngineReceipt(
    action: (engine: DshChatEngineClient) => Promise<SubmitReceipt>,
  ): Promise<SubmitReceipt> {
    const engine = await this.ensureEngine();
    if (!engine) return { kind: "rejected", error: "Chat engine is not ready." };
    return action(engine);
  }

  private async ensureEngine(): Promise<DshChatEngineClient | null> {
    if (this.engine) return this.engine;
    try {
      const client = await this.client();
      const engine = new DshChatEngineClient({
        client,
        // Child addresses persist in the renderer sessions runtime's local
        // meta (mainStore); resolve them here so hosted runs keep subagent
        // continuation semantics without any window-local knowledge.
        resolveSubagent: (sessionId) => this.resolveSubagent(sessionId),
        // Same session.create directory policy as the renderer's
        // `resolveSessionCreationWorkspace`, served by the main workspace
        // manager and the same DSH client.
        resolveSession: async (payload, signal) => {
          const { cwd, workspaceId } = await this.resolveSessionWorkspace(
            payload.sessionId,
            signal,
          );
          return {
            ...(cwd === undefined ? {} : { cwd }),
            ...(workspaceId === undefined ? {} : { workspaceId }),
          };
        },
        selectModel: async (sessionId, selection, signal) => {
          await client.selectModel({ sessionId, ...selection }, signal);
        },
        // The official draft registry is renderer-local; the engine asks the
        // submitting window to serialize its drafts. `put`/`remove` belong to
        // the renderer's own draft flow and are never called by the engine.
        attachments: {
          serialize: (sessionId, ids, signal) =>
            this.serializeDrafts(sessionId, [...ids], signal),
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
        sessionActivity: (sessionId) => this.activitySource(sessionId),
      });
      engine.onSnapshot((frame) => {
        if (frame.type !== "snapshot") return;
        this.route(frame.sessionId, frame);
      });
      engine.onStreamEvent((sessionId, event) => {
        this.route(sessionId, { type: "event", sessionId, event });
      });
      this.engine = engine;
      this.startRunningPoller();
      return engine;
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
    let set = this.subscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(sessionId, set);
    }
    const first = set.size === 0;
    set.add(webContentsId);
    if (subagent) this.addresses.set(sessionId, subagent);
    if (!this.engine) {
      // Subscribers race the runtime; attach everything once the engine is
      // live. The snapshot is re-emitted to every listener at that point, so
      // windows that joined while the engine was cold still get their state.
      void this.ensureEngine().then((engine) => {
        if (!engine || !this.subscribers.get(sessionId)?.size) return;
        if (this.subscribers.get(sessionId)?.size === 1) {
          engine.follow(sessionId, this.addresses.get(sessionId));
        }
        engine.subscribe(sessionId);
      });
      return;
    }
    // Only the FIRST viewer of a session opens its durable journal follow;
    // `engine.subscribe` stays idempotent and re-emits the current snapshot
    // to every listener, so a later viewer joining a followed session also
    // receives the run state it needs to render.
    if (first) this.engine.follow(sessionId, this.addresses.get(sessionId));
    this.engine.subscribe(sessionId);
  }

  private unsubscribe(webContentsId: number, sessionId: string): void {
    const set = this.subscribers.get(sessionId);
    if (!set) return;
    set.delete(webContentsId);
    this.addresses.delete(sessionId);
    if (set.size > 0) return;
    this.subscribers.delete(sessionId);
    this.submitters.delete(sessionId);
    this.engine?.unfollow(sessionId);
    this.activityListeners.delete(sessionId);
  }

  private route(sessionId: string, message: EngineToClientMessage): void {
    const set = this.subscribers.get(sessionId);
    if (!set) return;
    for (const id of set) {
      const contents = contentsOf(id);
      if (contents && !contents.isDestroyed()) {
        contents.send("chat-engine:message", message);
      }
    }
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
    const parent = this.parentBySession.get(sessionId);
    if (parent) {
      return {
        parentSessionId: parent,
        childSessionId: sessionId,
        mode: "continuable",
      };
    }
    return undefined;
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
      })
      .catch(() => {});
  }

  private async resolveSessionWorkspace(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ cwd?: string; workspaceId?: string }> {
    // Mirror `resolveSessionCreationWorkspace` with main-process surfaces.
    const bindings = workspaceManager.listBindings();
    const bound = bindings[sessionId];
    const existing = (
      await this.client()
        .then((client) => client.listSessions(signal))
        .catch(() => ({ items: [] }))
    ).items.find((session) => session.sessionId === sessionId);
    const boundOrExisting = bound
      ? bound
      : existing?.cwd
        ? ((await workspaceManager.bindIfUnbound(sessionId, existing.cwd).catch(() => null)) ??
          undefined)
        : undefined;
    const cwd = boundOrExisting ?? (await workspaceManager.getDefaultRoot().catch(() => undefined));
    if (!cwd) return {};
    if (existing?.cwd) {
      const runtimeCwd = await workspaceManager
        .resolveRuntimeCwd(sessionId, existing.cwd)
        .catch(() => undefined);
      if (runtimeCwd !== undefined) return { cwd: runtimeCwd };
    }
    if (Object.hasOwn(bindings, sessionId)) {
      try {
        const client = await this.client();
        const { workspace } = await client.createWorkspace(cwd, signal);
        return { workspaceId: workspace.workspaceId };
      } catch {
        // Workspace creation can fail transiently; fall back to the cwd.
      }
    }
    return { cwd };
  }

  private activitySource(sessionId: string): DshSessionActivitySource {
    return {
      getSnapshot: () => {
        this.startRunningPoller();
        return { running: this.runningBySession.get(sessionId) ?? false };
      },
      subscribe: (listener) => {
        let set = this.activityListeners.get(sessionId);
        if (!set) {
          set = new Set();
          this.activityListeners.set(sessionId, set);
        }
        set.add(listener);
        return () => {
          set?.delete(listener);
        };
      },
    };
  }

  private startRunningPoller(): void {
    if (this.runningTimer) return;
    this.runningTimer = setInterval(() => void this.pollRunning(), 2_000);
    this.runningTimer.unref?.();
    void this.pollRunning();
  }

  private async pollRunning(): Promise<void> {
    try {
      const client = await this.client();
      const { items } = await client.listSessions();
      const next = new Map<string, boolean>();
      const parents = new Map<string, string>();
      for (const item of items) {
        next.set(item.sessionId, item.running);
        if (item.parentSessionId) parents.set(item.sessionId, item.parentSessionId);
      }
      this.runningBySession = next;
      this.parentBySession = parents;
      for (const listeners of this.activityListeners.values()) {
        for (const listener of listeners) listener();
      }
    } catch {
      // Runtime not ready — keep the last running map.
    }
  }

  private async serializeDrafts(
    sessionId: string,
    ids: string[],
    signal?: AbortSignal,
  ): Promise<DshPromptContentPart[]> {
    const submitter = this.submitters.get(sessionId);
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