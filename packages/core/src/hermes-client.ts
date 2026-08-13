/**
 * Minimal OpenAI-compatible Chat Completions client targeting the Hermes
 * gateway HTTP API (`gateway/platforms/api_server.py`).
 *
 * Streams server-sent events via fetch+ReadableStream. Calls the per-message
 * `onChunk` callback with each `delta.content` string. Resolves to the final
 * accumulated text once the stream completes (or `[DONE]` arrives).
 */

import { backplaneFetch } from "./backplane-client";
import type { ChatMessage } from "./chat-messages";
import { hermesAgentPath, type AgentExecutionContext } from "./agent-context";
// Wire-protocol types live alongside this file in core. Local imports only —
// re-exports happen from packages/core/src/index.ts.
import type {
  ApprovalRecord,
  HermesApprovalDecision,
  HermesApprovalRequest,
  HermesLiveAgent,
  HermesToolProgress,
  StreamedToolCall,
} from "./hermes-gateway-types";

export interface HermesClientOptions {
  model: string;
  sessionId?: string;
  agent?: AgentExecutionContext;
  /** Forwarded to fetch as AbortSignal; lets the side panel cancel mid-stream. */
  signal?: AbortSignal;
}

export interface StreamHandlers {
  onChunk?: (delta: string) => void;
  /** Full merged tool-call rows after each SSE chunk that carries tool deltas. */
  onToolCallsState?: (calls: StreamedToolCall[]) => void;
  /** Model reasoning / thinking tokens when the gateway forwards them. */
  onReasoningChunk?: (delta: string) => void;
  /**
   * Hermes-specific tool-progress events from the gateway's
   * `event: hermes.tool.progress` SSE channel. Use this for live trace UI
   * — `delta.tool_calls` on the standard chat-completions channel is empty
   * in Hermes's agent mode.
   */
  onHermesToolProgress?: (event: HermesToolProgress) => void;
  /**
   * `event: approval.request` — agent is blocked waiting for user consent.
   * Caller is expected to render approval UI and POST the decision back
   * to `/v1/runs/{runId}/approval`.
   */
  onApprovalRequest?: (request: HermesApprovalRequest) => void;
  /**
   * `event: approval.responded` (or `approval.resolved`) — gateway has
   * processed the decision, the corresponding pending UI can drop.
   */
  onApprovalResolved?: (approvalId: string) => void;
  onSession?: (sessionId: string) => void;
  /**
   * Hermes-assigned run id, captured from the `X-Hermes-Run-Id` response
   * header on the chat-completions request. Needed when posting an
   * approval decision since the path is keyed by run id, not session id.
   */
  onRun?: (runId: string) => void;
  /**
   * Token usage for the turn, surfaced exactly once from the final
   * chat.completion.chunk before [DONE] (see api_server.py
   * `_write_sse_chat_completion`). Field names are OpenAI-style
   * (prompt/completion/total). Fires only when the gateway included a
   * `usage` field — older gateway builds may omit it, in which case
   * this callback simply never runs.
   *
   * Drives the token-meter extension and any other usage-tracking
   * surface that needs per-turn input/output token counts.
   */
  onUsage?: (usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }) => void;
}

/**
 * Stream a Chat Completions request. Returns the assembled assistant text on
 * success. Throws on non-2xx HTTP or stream-level errors.
 */
export async function streamChat(
  messages: ChatMessage[],
  opts: HermesClientOptions,
  handlers: StreamHandlers = {},
): Promise<string> {
  const path = hermesAgentPath(opts.agent?.profileId, "/v1/chat/completions");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  // Always set the session header when sessionId is supplied — the
  // backplane proxy strips it before forwarding when the gateway
  // isn't running with API_SERVER_KEY (would otherwise 403).
  if (opts.sessionId) headers["X-Hermes-Session-Id"] = opts.sessionId;

  const body = JSON.stringify({
    model: opts.model,
    stream: true,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    })),
  });

  const res = await backplaneFetch(path, {
    method: "POST",
    headers,
    body,
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new HermesHttpError(res.status, text || res.statusText, path);
  }
  const sessionHeader =
    res.headers.get("X-Hermes-Session-Id") ||
    res.headers.get("x-hermes-session-id");
  if (sessionHeader && handlers.onSession) handlers.onSession(sessionHeader);
  // `X-Hermes-Run-Id` is needed to POST approval decisions back to
  // `/v1/runs/{runId}/approval`. The header isn't guaranteed across all
  // gateway versions — we'll also try to lift it from the approval
  // request payload itself as a fallback.
  const runHeader =
    res.headers.get("X-Hermes-Run-Id") || res.headers.get("x-hermes-run-id");
  if (runHeader && handlers.onRun) handlers.onRun(runHeader);

  if (!res.body) throw new Error("Hermes returned no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let assembled = "";
  const toolCallsAcc = new Map<
    number,
    { index: number; id?: string; name: string; arguments: string }
  >();

  function mergeToolCallDeltas(toolDeltas: unknown): StreamedToolCall[] | null {
    if (!Array.isArray(toolDeltas) || toolDeltas.length === 0) return null;
    for (const raw of toolDeltas) {
      if (!raw || typeof raw !== "object") continue;
      const tc = raw as Record<string, unknown>;
      const idx = typeof tc.index === "number" ? tc.index : 0;
      const prev = toolCallsAcc.get(idx) ?? {
        index: idx,
        name: "",
        arguments: "",
      };
      if (typeof tc.id === "string" && tc.id) prev.id = tc.id;
      const fn = tc.function as Record<string, unknown> | undefined;
      if (fn) {
        if (typeof fn.name === "string" && fn.name) prev.name = fn.name;
        if (typeof fn.arguments === "string" && fn.arguments)
          prev.arguments += fn.arguments;
      }
      toolCallsAcc.set(idx, prev);
    }
    return Array.from(toolCallsAcc.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({ ...v }));
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const parsed = parseEvent(frame);
      if (parsed != null) {
        const { event, data } = parsed;
        if (data === "[DONE]") return assembled;
        if (event === "hermes.tool.progress") {
          try {
            const obj = JSON.parse(data);
            if (
              obj &&
              typeof obj === "object" &&
              typeof obj.tool === "string" &&
              typeof obj.toolCallId === "string" &&
              (obj.status === "running" || obj.status === "completed")
            ) {
              handlers.onHermesToolProgress?.({
                tool: obj.tool,
                toolCallId: obj.toolCallId,
                status: obj.status,
                label: typeof obj.label === "string" ? obj.label : undefined,
                emoji: typeof obj.emoji === "string" ? obj.emoji : undefined,
              });
            }
          } catch {
            // Non-JSON progress payload; ignore.
          }
        } else if (
          event === "approval.request" ||
          event === "approval.requested" ||
          event === "hermes.approval.request" ||
          event === "hermes.approval.requested"
        ) {
          // The gateway hasn't pinned an exact field naming for the
          // request payload in this codebase. Accept the common spellings
          // (snake_case + camelCase + a few aliases) and keep the raw
          // object on hand for debugging if the wire format drifts.
          try {
            const obj = JSON.parse(data) as Record<string, unknown>;
            const approvalId = String(
              obj.approval_id ??
                obj.approvalId ??
                obj.request_id ??
                obj.requestId ??
                obj.id ??
                "",
            );
            const ridFromEvent = String(obj.run_id ?? obj.runId ?? "");
            const runId = ridFromEvent || runHeader || "";
            if (!approvalId) {
              console.warn(
                "[hermes-client] approval.request without an id:",
                obj,
              );
            }
            handlers.onApprovalRequest?.({
              approvalId,
              runId,
              profileId: opts.agent?.profileId,
              tool: typeof obj.tool === "string" ? obj.tool : undefined,
              command:
                typeof obj.command === "string"
                  ? obj.command
                  : typeof obj.cmd === "string"
                    ? obj.cmd
                    : undefined,
              description:
                typeof obj.description === "string"
                  ? obj.description
                  : typeof obj.detail === "string"
                    ? obj.detail
                    : undefined,
              reason: typeof obj.reason === "string" ? obj.reason : undefined,
              raw: obj,
            });
          } catch (e) {
            console.warn(
              "[hermes-client] failed to parse approval.request:",
              e,
              data,
            );
          }
        } else if (
          event === "approval.responded" ||
          event === "approval.resolved" ||
          event === "hermes.approval.responded" ||
          event === "hermes.approval.resolved"
        ) {
          try {
            const obj = JSON.parse(data) as Record<string, unknown>;
            const approvalId = String(
              obj.approval_id ??
                obj.approvalId ??
                obj.request_id ??
                obj.requestId ??
                obj.id ??
                "",
            );
            if (approvalId) handlers.onApprovalResolved?.(approvalId);
          } catch (e) {
            console.warn(
              "[hermes-client] failed to parse approval.responded:",
              e,
              data,
            );
          }
        } else if (event !== "message") {
          // The gateway sometimes ships custom SSE channels we don't know
          // about yet (notably the approval-flow events, which may use a
          // spelling we haven't enumerated above). Surface them in the
          // console so we can spot the actual wire name + payload shape
          // without having to wireshark the connection. Truncated to
          // keep the log readable on long payloads.
          const preview = data.length > 240 ? data.slice(0, 240) + "…" : data;
          console.debug(
            `[hermes-client] unhandled SSE event "${event}":`,
            preview,
          );
        } else {
          try {
            const obj = JSON.parse(data);
            const delta = obj?.choices?.[0]?.delta;
            if (delta?.content) {
              const c = delta.content;
              const piece = typeof c === "string" ? c : "";
              if (piece) {
                assembled += piece;
                handlers.onChunk?.(piece);
              }
            }
            const rc = delta?.reasoning_content;
            if (typeof rc === "string" && rc.length > 0) {
              handlers.onReasoningChunk?.(rc);
            }
            if (delta?.tool_calls) {
              const merged = mergeToolCallDeltas(delta.tool_calls);
              if (merged && merged.length > 0) {
                handlers.onToolCallsState?.(merged);
              }
            }
            // The gateway tacks `usage` onto the final chat.completion.chunk
            // (the finish_reason="stop" frame, see api_server.py). It only
            // appears once per stream, so a simple side-channel emit is fine
            // — no accumulator needed.
            if (obj?.usage && typeof obj.usage === "object") {
              const u = obj.usage as Record<string, unknown>;
              handlers.onUsage?.({
                prompt_tokens: Number(u.prompt_tokens) || 0,
                completion_tokens: Number(u.completion_tokens) || 0,
                total_tokens: Number(u.total_tokens) || 0,
              });
            }
          } catch {
            // Non-JSON chunk; ignore.
          }
        }
      }
      idx = buffer.indexOf("\n\n");
    }
  }
  return assembled;
}

function parseEvent(block: string): { event: string; data: string } | null {
  // SSE frame: one or more `data: ...` lines (concatenated with '\n'), plus
  // an optional `event: <name>` line. `id:` is ignored. Default event name
  // for streams without an explicit `event:` is `"message"` per the SSE spec.
  let event = "message";
  let payload = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) {
      payload += line.slice(5).trimStart() + "\n";
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }
  }
  payload = payload.replace(/\n$/, "");
  return payload.length ? { event, data: payload } : null;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * POST a decision to `/v1/runs/{runId}/approval`. Both the panel (after
 * a user click) and the background engine could in theory call this; we
 * keep it parameter-driven so neither has to import the other's
 * settings/config shape.
 */
export async function postHermesApprovalDecision(opts: {
  runId: string;
  approvalId: string;
  decision: HermesApprovalDecision;
  profileId?: string;
}): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!opts.runId) return { ok: false, error: "missing run id" };
  if (!opts.approvalId) return { ok: false, error: "missing approval id" };
  const path = hermesAgentPath(
    opts.profileId,
    `/v1/runs/${encodeURIComponent(opts.runId)}/approval`,
  );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  try {
    // The gateway expects `{choice: "once|session|always|deny"}`. We retain
    // `approval_id` in the JSON only as a forward-compat hint — the v0.13
    // gateway ignores it; older/forked builds that did consume an id will
    // still find what they expect.
    const res = await backplaneFetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({
        choice: opts.decision,
        approval_id: opts.approvalId,
      }),
    });
    if (!res.ok) {
      const text = await safeText(res);
      return {
        ok: false,
        status: res.status,
        error: text || res.statusText,
      };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

// ===========================================================================
// /v1/runs streaming — the modern Hermes API surface.
//
// Why this exists alongside `streamChat`: `/v1/chat/completions` doesn't
// register approval callbacks server-side, so dangerous-command prompts
// are silently auto-approved and never surface to the client (see
// gateway/platforms/api_server.py:_run_agent and tools/approval.py
// :_is_gateway_approval_context). The runs surface DOES register them, at
// the cost of a custom event shape — each frame is a bare `data: {json}\n\n`
// where the JSON carries an `event` discriminator and a payload, rather
// than the OpenAI `choices[].delta.content` shape.
// ===========================================================================

/** Subset of `tool_progress_callback` event types the runs SSE forwards. */
export interface RunToolStarted {
  tool: string;
  /** Stable Hermes tool-call id. Missing on older gateways. */
  toolCallId?: string;
  /** Human-readable preview, e.g. `"my_browser_navigate https://example.com"`. */
  preview?: string;
  /** Redacted structured arguments. Missing on older gateways. */
  args?: Record<string, unknown>;
}

export interface RunToolCompleted {
  tool: string;
  /** Stable Hermes tool-call id. Missing on older gateways. */
  toolCallId?: string;
  /** Seconds the tool spent running. */
  duration?: number;
  /** True when the underlying tool raised an error. */
  error?: boolean;
  /** Redacted structured arguments. */
  args?: Record<string, unknown>;
  /** Bounded, redacted result payload. */
  result?: unknown;
  /** Bounded edit diff for file-mutating tools. */
  inlineDiff?: string;
}

export type RunMoaEvent =
  | {
      kind: "progress";
      label?: string;
      refsDone: number;
      refsTotal: number;
    }
  | {
      kind: "phase";
      phase: string;
      aggregator?: string;
      refsDone?: number;
      refsTotal?: number;
    }
  | {
      kind: "reference";
      label?: string;
      text: string;
      index?: number;
      count?: number;
    }
  | {
      kind: "aggregating";
      aggregator?: string;
      refCount?: number;
    };

export interface RunHandlers {
  /** `event: "message.delta"` — assistant text chunk. */
  onMessageDelta?: (delta: string) => void;
  /**
   * `event: "reasoning.available"` — one-shot reasoning text the model
   * emitted. Unlike chat-completions, this isn't streamed delta-by-delta.
   */
  onReasoning?: (text: string) => void;
  /** `event: "tool.started"` */
  onToolStarted?: (event: RunToolStarted) => void;
  /** `event: "tool.completed"` */
  onToolCompleted?: (event: RunToolCompleted) => void;
  /** Structured lifecycle emitted while a Mixture-of-Agents preset runs. */
  onMoaEvent?: (event: RunMoaEvent) => void;
  /** Native delegated-agent lifecycle and activity updates. */
  onSubagentEvent?: (event: HermesLiveAgent) => void;
  /** `event: "approval.request"` — agent paused waiting for user consent. */
  onApprovalRequest?: (request: HermesApprovalRequest) => void;
  /**
   * `event: "approval.responded"` — the gateway has processed a decision.
   * Carries `choice` and `resolved` (count) but no approval id, so the
   * caller must reconcile with whatever id it synthesized at request time.
   */
  onApprovalResponded?: (info: {
    choice: HermesApprovalDecision;
    resolved: number;
  }) => void;
  /** `event: "run.completed"` — final answer in `output`, plus token usage. */
  onRunCompleted?: (info: {
    output: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  }) => void;
  /** `event: "run.failed"` */
  onRunFailed?: (info: { error: string }) => void;
  /** `event: "run.cancelled"` */
  onRunCancelled?: () => void;
}

export interface RunAgentOptions {
  /** Long-term session-key for memory scoping (`X-Hermes-Session-Key` header). */
  sessionKey?: string;
  /** Hermes session id for short-term chat continuity. */
  sessionId?: string;
  /** Profile + task-scoped response mode selected by Amiba. */
  agent?: AgentExecutionContext;
  /**
   * Absolute workspace directory for this turn. Sent as structured ``cwd``
   * metadata so Hermes binds its session context and tool task before the
   * agent starts; it is never inferred from prompt text.
   */
  workingDirectory?: string;
  /** Optional model override; the gateway has its own default. */
  model?: string;
  /** System prompt → goes into the `instructions` request field. */
  instructions?: string;
  /** AbortSignal cancels the events fetch AND fires `/v1/runs/{id}/stop`. */
  signal?: AbortSignal;
  /**
   * Called as soon as the gateway hands back a `run_id` (after POST /v1/runs
   * returns 202). Lets the engine record the id for later approval
   * routing before any event has been delivered.
   */
  onRun?: (runId: string) => void;
  /**
   * Per-turn read-only context for tool handlers (e.g. frozen browser-tab
   * snapshot). PUT to the backplane's ``/hermes/turn-metadata`` side
   * channel BEFORE the ``/v1/runs`` POST and looked up by tool handlers
   * over loopback (see ``amiba-plugin-browser-tools`` →
   * ``_fetch_turn_metadata``). The lookup key is the same session key
   * api_server resolves as its ``approval_session_key``:
   * ``sessionKey`` header > ``sessionId`` body. Never lands in the
   * prompt — purely a tool-side concern. Optional; older surfaces omit.
   *
   * No ``sessionKey``/``sessionId`` → the side-channel PUT is skipped
   * silently (the run_id-derived fallback isn't knowable client-side),
   * and tools fall back to live behaviour.
   */
  turnMetadata?: import("./chat-engine-protocol").TurnMetadata;
}

/**
 * Drive one agent turn through the `/v1/runs` surface.
 *
 * Two-step protocol:
 *   1. `POST /v1/runs` returns 202 with `{run_id, status: "started"}` and
 *      the agent kicks off in a background asyncio task.
 *   2. `GET /v1/runs/{run_id}/events` is an SSE stream whose frames are
 *      bare `data: {json}\n\n` payloads — each carries an `event` field
 *      identifying the type, plus per-event extras (`delta`, `tool`,
 *      `command`, etc.).
 *
 * The function resolves once the stream emits a terminal event
 * (`run.completed`, `run.failed`, or `run.cancelled`) and the connection
 * closes. On AbortSignal, fires a fire-and-forget POST to the stop
 * endpoint so the agent thread actually halts (the SSE fetch by itself
 * just disconnects the spectator).
 */
export async function runHermesAgent(
  messages: ChatMessage[],
  opts: RunAgentOptions,
  handlers: RunHandlers = {},
): Promise<void> {
  const route = (path: string) => hermesAgentPath(opts.agent?.profileId, path);
  // Phase 1: kick off the run.
  const startHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // Always set the session-key header when supplied — the backplane
  // proxy strips it before forwarding when the gateway isn't running
  // with API_SERVER_KEY (would otherwise 403).
  if (opts.sessionKey) startHeaders["X-Hermes-Session-Key"] = opts.sessionKey;

  // Hermes splits a list `input` so the last entry is the user message and
  // the earlier ones become conversation history. That matches our internal
  // shape exactly, so we hand the whole array straight through.
  const startBody: Record<string, unknown> = {
    input: messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    })),
  };
  const instructions =
    opts.instructions?.trim() || opts.agent?.personality?.prompt?.trim() || "";
  if (instructions) startBody.instructions = instructions;
  if (opts.model) startBody.model = opts.model;
  if (opts.sessionId) startBody.session_id = opts.sessionId;
  if (opts.workingDirectory) startBody.cwd = opts.workingDirectory;

  // Turn metadata travels OUT OF BAND so it never enters the prompt
  // path. The backplane side-channel must hold the snapshot before
  // ``/v1/runs`` returns — otherwise a fast tool dispatch could fire
  // its GET before our PUT lands. await before kicking off the run.
  if (opts.turnMetadata) {
    const metadataKey = opts.sessionKey || opts.sessionId;
    if (metadataKey) {
      try {
        const metaRes = await backplaneFetch("/hermes/turn-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_key: metadataKey,
            metadata: opts.turnMetadata,
          }),
        });
        if (!metaRes.ok) {
          console.warn(
            "[hermes] turn-metadata PUT returned",
            metaRes.status,
            "— tools will fall back to live state",
          );
        }
      } catch (err) {
        // Network failure on the loopback PUT — log and proceed. The
        // run still works; tool handlers just lose the snapshot.
        console.warn("[hermes] turn-metadata PUT failed:", err);
      }
    } else {
      console.warn(
        "[hermes] turnMetadata supplied without sessionKey/sessionId — " +
          "no addressable side-channel key, snapshot dropped",
      );
    }
  }

  const startPath = route("/v1/runs");
  const startRes = await backplaneFetch(startPath, {
    method: "POST",
    headers: startHeaders,
    body: JSON.stringify(startBody),
    // Important: `opts.signal` is intentionally NOT attached here — if the
    // user aborts before the POST returns, we can't issue the `/stop` call
    // (no run id yet) and there's nothing to clean up anyway. We propagate
    // abort only to the events fetch below.
  });
  if (!startRes.ok) {
    const text = await safeText(startRes);
    throw new HermesHttpError(
      startRes.status,
      text || startRes.statusText,
      startPath,
    );
  }
  const startJson = (await startRes.json()) as { run_id?: string };
  const runId = startJson.run_id;
  if (!runId) {
    throw new Error("Hermes /v1/runs response missing run_id");
  }
  opts.onRun?.(runId);

  // Phase 2: subscribe to the event stream. Wire abort → /stop here.
  const ctrl = opts.signal ? null : new AbortController();
  const sig = opts.signal ?? ctrl!.signal;
  const stopOnAbort = () => {
    void backplaneFetch(route(`/v1/runs/${encodeURIComponent(runId)}/stop`), {
      method: "POST",
      // Don't await; this is best-effort cleanup.
      keepalive: true,
    }).catch(() => {});
  };
  // Fire stop the moment we observe an abort — including signals that
  // were already aborted before we got here.
  if (sig.aborted) stopOnAbort();
  sig.addEventListener("abort", stopOnAbort, { once: true });

  const eventsHeaders: Record<string, string> = {
    Accept: "text/event-stream",
  };

  const eventsPath = route(`/v1/runs/${encodeURIComponent(runId)}/events`);
  const eventsRes = await backplaneFetch(eventsPath, {
    method: "GET",
    headers: eventsHeaders,
    signal: sig,
  });
  if (!eventsRes.ok) {
    const text = await safeText(eventsRes);
    throw new HermesHttpError(
      eventsRes.status,
      text || eventsRes.statusText,
      eventsPath,
    );
  }
  if (!eventsRes.body) {
    throw new Error("Hermes /v1/runs events response had no body");
  }

  const reader = eventsRes.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  // Synthesized id per pending approval — the gateway events don't carry
  // an explicit `approval_id`, so we mint one from `run_id + pattern_key +
  // timestamp`. The matching `approval.responded` carries `choice` +
  // `resolved` count but no id reference, so the engine has to reconcile
  // by FIFO order against whatever ids it minted.
  // (No per-event state needed here — we just hand the synthesized id to
  // the handler.)

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      // Server comment lines (`: keepalive`, `: stream closed`) carry no
      // `data:`, so parseEvent returns null — skip cleanly.
      const parsed = parseEvent(frame);
      if (parsed == null) {
        idx = buffer.indexOf("\n\n");
        continue;
      }
      const { data } = parsed;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(data) as Record<string, unknown>;
      } catch (e) {
        console.warn("[hermes-client] /v1/runs malformed frame:", e, data);
        idx = buffer.indexOf("\n\n");
        continue;
      }
      const evt = String(obj.event ?? "");
      switch (evt) {
        case "message.delta": {
          const delta = obj.delta;
          if (typeof delta === "string" && delta.length > 0) {
            handlers.onMessageDelta?.(delta);
          }
          break;
        }
        case "reasoning.available": {
          const text = obj.text;
          if (typeof text === "string" && text.length > 0) {
            handlers.onReasoning?.(text);
          }
          break;
        }
        case "moa.progress": {
          handlers.onMoaEvent?.({
            kind: "progress",
            label: typeof obj.label === "string" ? obj.label : undefined,
            refsDone: typeof obj.refs_done === "number" ? obj.refs_done : 0,
            refsTotal: typeof obj.refs_total === "number" ? obj.refs_total : 0,
          });
          break;
        }
        case "moa.phase": {
          handlers.onMoaEvent?.({
            kind: "phase",
            phase: typeof obj.phase === "string" ? obj.phase : "",
            aggregator:
              typeof obj.aggregator === "string" ? obj.aggregator : undefined,
            refsDone:
              typeof obj.refs_done === "number" ? obj.refs_done : undefined,
            refsTotal:
              typeof obj.refs_total === "number" ? obj.refs_total : undefined,
          });
          break;
        }
        case "moa.reference": {
          handlers.onMoaEvent?.({
            kind: "reference",
            label: typeof obj.label === "string" ? obj.label : undefined,
            text: typeof obj.text === "string" ? obj.text : "",
            index: typeof obj.index === "number" ? obj.index : undefined,
            count: typeof obj.count === "number" ? obj.count : undefined,
          });
          break;
        }
        case "moa.aggregating": {
          handlers.onMoaEvent?.({
            kind: "aggregating",
            aggregator:
              typeof obj.aggregator === "string" ? obj.aggregator : undefined,
            refCount:
              typeof obj.ref_count === "number" ? obj.ref_count : undefined,
          });
          break;
        }
        case "subagent.spawn_requested":
        case "subagent.start":
        case "subagent.tool":
        case "subagent.progress":
        case "subagent.thinking":
        case "subagent.complete": {
          const stringValue = (key: string): string | undefined =>
            typeof obj[key] === "string" && obj[key]
              ? String(obj[key])
              : undefined;
          const numberValue = (key: string): number | undefined =>
            typeof obj[key] === "number" && Number.isFinite(obj[key])
              ? Number(obj[key])
              : undefined;
          const stringList = (key: string): string[] =>
            Array.isArray(obj[key])
              ? (obj[key] as unknown[]).filter(
                  (item): item is string => typeof item === "string",
                )
              : [];
          const goal =
            stringValue("goal") || stringValue("preview") || "Agent";
          const parentId = stringValue("parent_id") ?? null;
          const taskIndex = numberValue("task_index") ?? 0;
          const id =
            stringValue("subagent_id") ||
            `${parentId || "root"}:${taskIndex}:${goal}`;
          const rawStatus = stringValue("status");
          const status =
            rawStatus === "queued" ||
            rawStatus === "completed" ||
            rawStatus === "failed" ||
            rawStatus === "interrupted"
              ? rawStatus
              : evt === "subagent.spawn_requested"
                ? "queued"
                : evt === "subagent.complete"
                  ? "completed"
                  : "running";
          const timestamp = numberValue("timestamp");
          const now = timestamp ? timestamp * 1_000 : Date.now();
          handlers.onSubagentEvent?.({
            id,
            eventType: evt,
            parentId,
            goal,
            childSessionId: stringValue("child_session_id"),
            model: stringValue("model"),
            status,
            taskCount: numberValue("task_count") ?? 1,
            taskIndex,
            startedAt: now,
            updatedAt: now,
            durationSeconds: numberValue("duration_seconds"),
            costUsd: numberValue("cost_usd"),
            inputTokens: numberValue("input_tokens"),
            outputTokens: numberValue("output_tokens"),
            reasoningTokens: numberValue("reasoning_tokens"),
            toolCount: numberValue("tool_count"),
            filesRead: stringList("files_read"),
            filesWritten: stringList("files_written"),
            currentTool:
              evt === "subagent.tool" ? stringValue("tool_name") : undefined,
            progress:
              evt === "subagent.progress" || evt === "subagent.thinking"
                ? stringValue("preview")
                : undefined,
            summary: stringValue("summary"),
          });
          break;
        }
        case "tool.started": {
          handlers.onToolStarted?.({
            tool: String(obj.tool ?? ""),
            toolCallId:
              typeof obj.tool_call_id === "string"
                ? obj.tool_call_id
                : undefined,
            preview: typeof obj.preview === "string" ? obj.preview : undefined,
            args:
              obj.args &&
              typeof obj.args === "object" &&
              !Array.isArray(obj.args)
                ? (obj.args as Record<string, unknown>)
                : undefined,
          });
          break;
        }
        case "tool.completed": {
          handlers.onToolCompleted?.({
            tool: String(obj.tool ?? ""),
            toolCallId:
              typeof obj.tool_call_id === "string"
                ? obj.tool_call_id
                : undefined,
            duration:
              typeof obj.duration === "number" ? obj.duration : undefined,
            error: typeof obj.error === "boolean" ? obj.error : undefined,
            args:
              obj.args &&
              typeof obj.args === "object" &&
              !Array.isArray(obj.args)
                ? (obj.args as Record<string, unknown>)
                : undefined,
            result: obj.result,
            inlineDiff:
              typeof obj.inline_diff === "string" ? obj.inline_diff : undefined,
          });
          break;
        }
        case "approval.request": {
          // Synthesize a stable id since the gateway omits one. Include
          // the timestamp so reruns of the same pattern produce distinct
          // ids — handy for the panel's pending-approvals dedupe set.
          const patternKey = String(
            obj.pattern_key ?? obj.pattern_keys ?? "unknown",
          );
          const ts = String(obj.timestamp ?? Date.now());
          const approvalId = `${runId}:${patternKey}:${ts}`;
          handlers.onApprovalRequest?.({
            approvalId,
            runId,
            profileId: opts.agent?.profileId,
            tool: typeof obj.tool === "string" ? obj.tool : undefined,
            command: typeof obj.command === "string" ? obj.command : undefined,
            description:
              typeof obj.description === "string" ? obj.description : undefined,
            reason: typeof obj.reason === "string" ? obj.reason : undefined,
            raw: obj,
          });
          break;
        }
        case "approval.responded": {
          const choice = String(obj.choice ?? "");
          const allowed: HermesApprovalDecision[] = [
            "once",
            "session",
            "always",
            "deny",
          ];
          if ((allowed as string[]).includes(choice)) {
            handlers.onApprovalResponded?.({
              choice: choice as HermesApprovalDecision,
              resolved: typeof obj.resolved === "number" ? obj.resolved : 1,
            });
          }
          break;
        }
        case "run.completed": {
          handlers.onRunCompleted?.({
            output: typeof obj.output === "string" ? obj.output : "",
            usage: obj.usage as RunHandlers extends {
              onRunCompleted?: (info: { usage?: infer U }) => void;
            }
              ? U
              : undefined,
          });
          // The gateway closes the connection right after run.completed
          // (a `: stream closed` comment may follow), but bail out now so
          // the caller doesn't sit waiting for the EOF round-trip.
          try {
            sig.removeEventListener("abort", stopOnAbort);
          } catch {
            // older Safari/Edge — ignore.
          }
          return;
        }
        case "run.failed": {
          const err = typeof obj.error === "string" ? obj.error : "run failed";
          handlers.onRunFailed?.({ error: err });
          try {
            sig.removeEventListener("abort", stopOnAbort);
          } catch {
            // ignore
          }
          throw new Error(err);
        }
        case "run.cancelled": {
          handlers.onRunCancelled?.();
          try {
            sig.removeEventListener("abort", stopOnAbort);
          } catch {
            // ignore
          }
          // Treat cancellation like an abort so callers see the same
          // AbortError they would have on a local cancel.
          throw new DOMException("aborted", "AbortError");
        }
        default:
          if (evt) {
            console.debug(
              `[hermes-client] /v1/runs unhandled event "${evt}":`,
              obj,
            );
          }
      }
      idx = buffer.indexOf("\n\n");
    }
  }
  // Stream closed without a terminal event. Treat as completed-empty so
  // the caller drops out cleanly; the agent presumably ran to end and the
  // gateway just didn't emit run.completed (older gateway? bug?). Better
  // than throwing an opaque "stream ended" — the UI already has the
  // accumulated text from message.delta.
  try {
    sig.removeEventListener("abort", stopOnAbort);
  } catch {
    // ignore
  }
}

/**
 * Typed error so callers can render an actionable message based on the HTTP
 * status. The Hermes gateway uses 401 for missing/invalid Bearer key and 403
 * for CORS rejection or session-continuity-without-key violations.
 */
export class HermesHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly url: string;

  constructor(status: number, body: string, url: string) {
    super(`Hermes ${status}: ${body || "(empty)"}`);
    this.name = "HermesHttpError";
    this.status = status;
    this.body = body;
    this.url = url;
  }

  /** Human-friendly hint for the side panel's error banner. */
  hint(): string {
    if (this.status === 401) {
      return (
        "The Hermes gateway requires an API key. Open Settings and paste " +
        "the value of API_SERVER_KEY from ~/.hermes/.env."
      );
    }
    if (this.status === 403) {
      return (
        "CORS blocked by the gateway. Server-side fix (one shell command):\n" +
        "  printf '\\nAPI_SERVER_CORS_ORIGINS=*\\n' >> ~/.hermes/.env && " +
        "hermes gateway restart\n" +
        "(API server binds to 127.0.0.1 only, so '*' is safe.)"
      );
    }
    if (this.status === 404) {
      return (
        "Endpoint not found. Verify the API base URL in Settings — it should " +
        "end in /v1, e.g. http://127.0.0.1:18642/v1"
      );
    }
    if (this.status >= 500) {
      return "Hermes gateway error — check ~/.hermes/logs/gateway.log.";
    }
    return "";
  }
}
