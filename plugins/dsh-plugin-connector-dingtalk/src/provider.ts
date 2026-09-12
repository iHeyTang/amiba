import { registerDingtalkApp } from "./registration.js";
import { dingtalkMcpTools } from "./mcp-tools.js";
import { DWClient, GET_TOKEN_URL, TOPIC_CARD, TOPIC_ROBOT } from "dingtalk-stream";
import type { DWClientDownStream } from "dingtalk-stream";
import type {
  CapabilityDecl,
  ConnectorHandle,
  ConnectorProvider,
  ConnectorRuntime,
  ConnectorStatus,
  OnboardHandle,
  OnboardResult,
} from "@amiba/dsh-plugin-connector-core";

import {
  buildApprovalCardPrompt,
  buildApprovalCardSettled,
  type ApprovalCardPrompt,
  type ApprovalCardSettled,
} from "./approval-card.js";
import {
  dingtalkConfigSchema,
  translateCardCallback,
  translateRobotMessage,
  type DingtalkApprovalDecision,
  type DingtalkConnectorConfig,
} from "./translate.js";

/**
 * Callbacks the provider core wires up when constructing the Stream Mode
 * client. `realDingtalkDeps.createClient` maps these onto the SDK's
 * `registerCallbackListener(TOPIC_ROBOT, ...)` registration — the provider
 * core itself never touches the `dingtalk-stream` surface directly.
 *
 * Both members are deliberately synchronous (`void`, not `Promise<void>`):
 * the real SDK callback acks the platform unconditionally in a `finally`
 * (see `realDingtalkDeps.createClient` below), so nothing here is ever
 * awaited by the caller either — any async work triggered inside must swallow
 * its own errors rather than rely on being awaited.
 */
export interface DingtalkClientHandlers {
  /** Raw Stream Mode robot-message payload, already `JSON.parse`d from the
   * downstream socket frame's `data` string. */
  onRobotMessage(raw: unknown): void;
  /**
   * Raw Stream Mode `TOPIC_CARD` callback payload (a card-button click),
   * already `JSON.parse`d from the downstream socket frame's `data` string
   * — same calling convention as `onRobotMessage` above. `realDingtalkDeps
   * .createClient` registers this alongside `TOPIC_ROBOT`.
   */
  onCardCallback(raw: unknown): void;
  /**
   * Fires when the long connection is known to be down/reconnecting.
   * Optional: see `realDingtalkDeps.createClient`'s verification comment —
   * the installed SDK exposes no such event today, so real deps never call
   * this. Kept on the seam so the status mapping is still exercised via
   * fake deps and ready for a future real signal without a shape change.
   */
  onDown?(note: string): void;
}

/** Thin seam over `DWClient` — only what the provider core needs. */
export interface DwLike {
  connect(): Promise<void>;
  disconnect(): void;
  /**
   * Post-`connect()` reality check. This SDK's `connect()` never rejects
   * (see the `try { await client.connect() }` comment in `start()` below),
   * so a resolved `connect()` alone doesn't mean the long connection is up.
   * The real impl is a single read of the SDK's own `client.connected`
   * boolean — never polling, just the freshest value at the moment `start()`
   * asks.
   */
  isConnected(): boolean;
}

/** Where a card should land — the same `key`/`kind` shape `deliver`'s
 * `conversation` parameter already carries, narrowed to just what
 * `createCard` needs to address a DingTalk "open space". */
export interface DingtalkCardTarget {
  readonly conversationKey: string;
  readonly conversationKind: "p2p" | "group";
}

/** What `createCard` hands back once the platform accepts a card. */
export interface DingtalkCardCreateResult {
  /** Opaque id `updateCard` later addresses this same instance by. Not
   * necessarily anything DingTalk's own response body returns verbatim —
   * see `realDingtalkDeps.createCard`'s doc comment. */
  readonly cardInstanceId: string;
}

export interface DingtalkDeps {
  registerApp?(handle: OnboardHandle): Promise<OnboardResult>;
  createClient(config: DingtalkConnectorConfig, handlers: DingtalkClientHandlers): DwLike;
  /** Exchanges an access token via `GET_TOKEN_URL`; rejects on auth failure. Used only for validation. */
  token(config: DingtalkConnectorConfig): Promise<void>;
  /** Posts a reply body to a conversation's session webhook URL; rejects propagate to the outbox. */
  postWebhook(url: string, body: unknown): Promise<void>;
  /**
   * Creates and delivers a native interactive approval card into one
   * conversation, registered for Stream-mode callbacks. Optional — and
   * expected to be absent or to reject in practice today (see
   * `DingtalkConnectorConfig.approvalCardTemplateId`'s doc comment): a
   * connect with no working `createCard` simply can't present approvals
   * natively, and `runtime.requestApproval` resolves `null` so
   * messaging-core's text protocol carries the question instead (plan §5's
   * "卡片发送失败 → 降级为文字兜底"). The `approvalId` is threaded through
   * separately from `content` (rather than folded into it) because
   * `approval-card.ts`'s builders are pure and don't know about any one
   * request's id — this is the one place that stamps it into the outbound
   * card data (see `realDingtalkDeps.createCard`).
   */
  createCard?(
    config: DingtalkConnectorConfig,
    approvalId: string,
    target: DingtalkCardTarget,
    content: ApprovalCardPrompt,
  ): Promise<DingtalkCardCreateResult>;
  /**
   * Updates a previously created card instance to its settled variant.
   * Optional; a rejection is caught and logged by the caller
   * (`runtime.announceApprovalOutcome` never throws) — the approval has
   * already been decided by the time this runs, so there is nothing left to
   * fall back to.
   */
  updateCard?(
    config: DingtalkConnectorConfig,
    cardInstanceId: string,
    content: ApprovalCardSettled,
  ): Promise<void>;
  /**
   * Console-free logging seam: the provider core never calls `console.*`
   * directly. A swallowed `handle.onInbound` error is still observable
   * through this instead of hard-crashing the stream loop. Optional so
   * fakes in tests can omit it (the swallow just becomes silent).
   */
  log?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// capabilities() declares the official DingTalk MCP connection. User approval
// of specific capabilities is owned by MCP Manager; messaging stays independent.
// Verified at
// implementation time (`npm view dingtalk-mcp version` + `npm pack
// dingtalk-mcp@1.1.21` to inspect the published README.md directly):
//   - package/version: dingtalk-mcp@1.1.21 (pinned into the npx arg itself,
//     matching lark-mcp's convention — this package has no separate
//     "pinnedVersion" field the way CliProvisionSpec does).
//   - bin: `dist/cli.js`, invoked here via `npx -y dingtalk-mcp@1.1.21`
//     (stdio transport, the package's own documented usage).
//   - env var casing (verified verbatim from the README's example JSON, not
//     assumed): `DINGTALK_Client_ID` / `DINGTALK_Client_Secret` — an unusual
//     mixed-case pair, but that is what the shipped server actually reads.
//   - `ACTIVE_PROFILES`: comma-separated profile ids; the README's table
//     confirms `dingtalk-contacts`, `dingtalk-calendar`, and `dingtalk-tasks`
//     are all valid ids. Calendar and task profiles include create/update/delete
//     operations; this is not a read-only tool set. No message-sending or
//     app-management profile is enabled by this declaration.
// ---------------------------------------------------------------------------

const DINGTALK_MCP_PACKAGE = "dingtalk-mcp";
const DINGTALK_MCP_PINNED_VERSION = "1.1.21";
const DINGTALK_MCP_ACTIVE_PROFILES = "dingtalk-contacts,dingtalk-calendar,dingtalk-tasks";

function buildCapabilities(config: DingtalkConnectorConfig): CapabilityDecl[] {
  return [
    {
      kind: "mcp",
      service: { id: "dingtalk.mcp", name: "钉钉", version: DINGTALK_MCP_PINNED_VERSION },
      identity: JSON.stringify(["dingtalk", config.clientId]),
      tools: dingtalkMcpTools,
      spec: {
        serverName: "dingtalk",
        transport: "stdio",
        command: "npx",
        args: ["-y", `${DINGTALK_MCP_PACKAGE}@${DINGTALK_MCP_PINNED_VERSION}`],
        env: {
          DINGTALK_Client_ID: config.clientId,
          DINGTALK_Client_Secret: config.clientSecret,
          ACTIVE_PROFILES: DINGTALK_MCP_ACTIVE_PROFILES,
        },
        enabled: true,
      },
    },
  ];
}

/** Per-conversation session webhook, latest inbound message wins. */
interface StoredWebhook {
  url: string;
  expiredAt?: number;
}

/** A human's answer collected off the card — structurally
 * `@amiba/dsh-plugin-messaging-core`'s `ApprovalReply`, read/returned
 * structurally rather than imported (this plugin doesn't depend on that
 * package directly; `requestApproval`'s return type is inferred from
 * `ConnectorRuntime`'s own declaration via contextual typing, the same way
 * `deliver`'s `envelope` parameter already is above). */
interface CardApprovalReply {
  outcome: DingtalkApprovalDecision;
  by?: string;
}

/** One native card `requestApproval` is waiting on (or has already settled
 * but not yet been announced) — see `pendingApprovals`'s doc comment above
 * for the lifecycle. */
interface PendingApproval {
  readonly cardInstanceId: string;
  /** The conversation the card was created into — a callback that names a
   * different one must never settle this question (plan §5). */
  readonly conversationKey: string;
  /** The caller's own sender rule for THIS question: messaging-core's
   * `channel.allowedSenders` narrowed by connector-core's `owners`/
   * `pairing` gate, re-read at click time. */
  canAnswer(sender: string | undefined): Promise<boolean>;
  /** Present exactly while nobody has settled this yet. `undefined` once a
   * click, an abort, or `stop()` has resolved the `requestApproval` promise
   * — a further card callback for the same id is then a no-op. */
  resolve?: (reply: CardApprovalReply | null) => void;
  /** Detaches the `AbortSignal` listener `requestApproval` registered.
   * Called once, from whichever of {card click, abort, stop()} settles the
   * entry first, so the other two paths' own listeners/checks never fire
   * again for it. */
  detachAbort?: () => void;
}

/** Settles a still-pending entry exactly once: clears `resolve`/
 * `detachAbort` (so a second click, a late abort, or `stop()` racing this
 * are all no-ops afterward) and resolves the waiting `requestApproval`
 * promise. The entry itself is NOT removed from `pendingApprovals` here —
 * only `announceApprovalOutcome` (normal end of life) or `stop()`
 * (teardown) do that, so `cardInstanceId` stays discoverable until the card
 * is actually flipped to its settled state. */
function settlePendingApproval(entry: PendingApproval, reply: CardApprovalReply | null): void {
  const resolve = entry.resolve;
  if (!resolve) return;
  entry.resolve = undefined;
  entry.detachAbort?.();
  entry.detachAbort = undefined;
  resolve(reply);
}

/**
 * Stops waiting on an entry WITHOUT resolving its promise — the abort path.
 *
 * Per `ConnectorRuntime.requestApproval`'s contract (and connector-lark's
 * identical reading of it): `request.signal` aborts precisely when the
 * question was settled by some other path, so messaging-core's own `settled`
 * promise has already won its race. Resolving `null` here instead would be
 * read as "this connect could not present the question natively", flipping
 * the relay's `presentation` to `"text"` and skipping the
 * `announceApprovalOutcome` that flips this card to 已超时拒绝 /
 * 已在桌面处理 — today only masked by a microtask-ordering accident. So:
 * detach, forget the resolver, and let the card sit until it is announced.
 */
function abandonPendingApproval(entry: PendingApproval): void {
  if (!entry.resolve) return;
  entry.resolve = undefined;
  entry.detachAbort?.();
  entry.detachAbort = undefined;
}

/**
 * DingTalk `ConnectorProvider`: runs the official Stream Mode long
 * connection (no public IP required), translates inbound robot messages
 * into `ConnectorInboundEnvelope`s, and delivers outbound text via each
 * message's own session webhook. `capabilities()` declares the official
 * `dingtalk-mcp` tool server; MCP Manager owns explicit access approval.
 */
export function createDingtalkProvider(
  deps: DingtalkDeps = realDingtalkDeps,
): ConnectorProvider {
  return {
    id: "dingtalk",
    messaging: { ownerPairing: true, sharedConversations: true },
    name: "钉钉 / DingTalk",
    description: "DingTalk robot over the official Stream Mode long connection.",
    configSchema: dingtalkConfigSchema,
    onboard: deps.registerApp ?? registerDingtalkApp,

    async validate(config: unknown): Promise<void> {
      const parsed = dingtalkConfigSchema.parse(config);
      await deps.token(parsed);
    },

    async start(handle: ConnectorHandle): Promise<ConnectorRuntime> {
      const config = dingtalkConfigSchema.parse(handle.config);
      // "constructing" — the stream client is about to be built.
      handle.setStatus({ state: "connecting" });

      // Declared before `deps.createClient(...)` below (not after
      // `client.connect()`) so every callback closure — including one that
      // could in principle fire synchronously during construction — sees a
      // real `false`, never a TDZ reference. `stop()` flips this to true and
      // every callback below checks it first: a callback racing a torn-down
      // connect (stop() already resolved, the center already deleted its
      // status entry) must not resurrect a status, or deliver an inbound
      // message, for a connect that no longer exists.
      let stopped = false;
      const safeSetStatus = (status: ConnectorStatus): void => {
        if (stopped) return;
        handle.setStatus(status);
      };

      // conversation key -> the most recent session webhook seen for it.
      const webhooks = new Map<string, StoredWebhook>();

      // approvalId -> the in-flight (or already-settled-but-not-yet-
      // announced) native card for it. `resolve` is present exactly while
      // `requestApproval`'s promise is still waiting on a human click or an
      // abort; it's cleared (not deleted) the moment either fires, so a
      // second click or a late `announceApprovalOutcome` call can still find
      // `cardInstanceId` — the entry is only ever fully removed by
      // `announceApprovalOutcome` (the normal end of life) or `stop()`
      // (teardown).
      const pendingApprovals = new Map<string, PendingApproval>();

      const client = deps.createClient(config, {
        onRobotMessage: (raw) => {
          if (stopped) return;
          const translation = translateRobotMessage(raw);
          if (!translation) return;
          const { envelope, sessionWebhook, sessionWebhookExpiredTime } = translation;
          if (sessionWebhook) {
            // Latest wins: a later message for the same conversation always
            // replaces whatever webhook (and expiry) was stored before it.
            webhooks.set(envelope.conversation.key, {
              url: sessionWebhook,
              expiredAt: sessionWebhookExpiredTime,
            });
          }
          // Fire-and-forget by design (see this interface's doc comment and
          // realDingtalkDeps.createClient below): the platform ack fires
          // unconditionally regardless of how long/whether this settles, so
          // errors here can only be swallowed and logged, never propagated.
          void handle.onInbound(envelope).catch((error: unknown) => {
            if (stopped) return;
            deps.log?.(
              `amiba-connector-dingtalk: handle.onInbound failed: ${String(error)}`,
            );
          });
        },
        onCardCallback: (raw) => {
          if (stopped) return;
          const callback = translateCardCallback(raw);
          if (!callback) return;
          const entry = pendingApprovals.get(callback.approvalId);
          // Mismatched id (not ours, or for a connect that never displayed
          // it) and a second click on an already-settled card both land
          // here as "no resolver waiting" — both are ignored with a warn,
          // per plan §5 ("同一审批多次回答 → 第一次生效，其余忽略").
          if (!entry || !entry.resolve) {
            deps.log?.(
              `amiba-connector-dingtalk: ignoring a card callback for approval ${callback.approvalId}: nothing is waiting on it`,
            );
            return;
          }
          // Cross-conversation guard: a card created into chat A must not
          // settle a question raised in chat B. Both fields are optional on
          // the (unverified) callback frame and are only ever used to
          // REFUSE a mismatch — a frame carrying neither still had to match
          // on `approvalId`, whose card instance exists in one conversation.
          if (
            callback.outTrackId !== undefined &&
            callback.outTrackId !== entry.cardInstanceId
          ) {
            deps.log?.(
              `amiba-connector-dingtalk: ignoring a card callback for approval ${callback.approvalId}: it names card ${callback.outTrackId}, not ${entry.cardInstanceId}`,
            );
            return;
          }
          if (
            callback.conversationKey !== undefined &&
            callback.conversationKey !== entry.conversationKey
          ) {
            deps.log?.(
              `amiba-connector-dingtalk: ignoring a card callback for approval ${callback.approvalId}: it came from conversation ${callback.conversationKey}, not ${entry.conversationKey}`,
            );
            return;
          }
          // Who may answer is the caller's rule (plan §2), re-read at click
          // time; `userId` is the staff id space inbound envelopes carry as
          // `sender`. Async, hence the detached task — the platform ack in
          // `handleCardFrame` does not wait on it.
          void (async () => {
            let allowed = false;
            try {
              allowed = await entry.canAnswer(callback.operatorUserId);
            } catch (error) {
              deps.log?.(
                `amiba-connector-dingtalk: could not check who may answer approval ${callback.approvalId}: ${String(error)}`,
              );
            }
            if (!allowed) {
              // Ignored, NOT settled and NOT acknowledged on the card: the
              // question keeps waiting for someone who may answer it.
              deps.log?.(
                `amiba-connector-dingtalk: ignoring approval ${callback.approvalId} clicked by ${callback.operatorUserId ?? "an unidentified user"}: that user may not answer it`,
              );
              return;
            }
            if (stopped || !entry.resolve) return;
            settlePendingApproval(entry, {
              outcome: callback.decision,
              by: callback.operatorUserId,
            });
          })();
        },
        onDown: () => safeSetStatus({ state: "connecting" }),
      });

      try {
        // Verified against the installed dingtalk-stream@2.1.6-beta.1's
        // compiled `_connect()` (dist/client.cjs): every failure path (bad
        // credentials, network error, non-101 handshake) is caught
        // internally, logged, and turned into `scheduleReconnect()` —
        // `connect()` always resolves, never rejects, on this SDK version.
        // The catch below is therefore dead code today; it's kept as a
        // protective seam in case a future SDK version starts rejecting.
        await client.connect();
      } catch (error) {
        safeSetStatus({ state: "error", detail: String(error) });
        throw error;
      }
      // Because connect() can't be trusted to reject on failure, ready vs.
      // still-connecting is decided from the SDK's own post-connect state
      // rather than assumed from connect() having resolved at all.
      safeSetStatus(client.isConnected() ? { state: "ready" } : { state: "connecting" });

      const runtime: ConnectorRuntime = {
        async stop(): Promise<void> {
          if (stopped) return;
          stopped = true;
          client.disconnect();
          webhooks.clear();
          // Mirrors the apiproxy teardown behavior task-1-report.md §4
          // describes for messaging-core's own relay: every question this
          // connect is still natively holding open resolves `null` (not a
          // decision — this connect is going away, it never got an answer)
          // rather than being left to dangle forever.
          for (const entry of pendingApprovals.values()) {
            settlePendingApproval(entry, null);
          }
          pendingApprovals.clear();
        },
        async deliver(conversation, envelope): Promise<void> {
          const stored = webhooks.get(conversation.key);
          const expired =
            stored?.expiredAt !== undefined && stored.expiredAt < Date.now();
          if (!stored || expired) {
            throw new Error("session_webhook_unavailable");
          }
          // DingTalk's session webhook is a short-lived, single-conversation
          // reply channel handed alongside each inbound robot message —
          // there is no independent "send anytime" call made here. When no
          // webhook is on file (no inbound message seen yet for this
          // conversation since this connect started) or the stored one has
          // expired, delivery fails and the messaging outbox's own
          // retry/backoff policy re-attempts it later — by which point a
          // fresh inbound message may have refreshed the entry. A proactive
          // -send fallback (a persistent robot access token plus the `POST
          // https://oapi.dingtalk.com/robot/send` API) is deferred — see the
          // M3 plan's "Deferred" section.
          //
          // No swallow here: an SDK/HTTP rejection must propagate so the
          // messaging outbox retries the delivery.
          await deps.postWebhook(stored.url, {
            msgtype: "text",
            text: { content: envelope.text },
          });
        },
        async requestApproval(conversation, request) {
          if (!deps.createCard) return null;
          // Already settled elsewhere before this even ran (a desktop
          // answer, a cancelled run): there is nothing to ask, so don't put
          // a card into the conversation that would be orphaned the moment
          // it lands. `null` is safe here precisely because the question is
          // already closed — no card exists for `announceApprovalOutcome`
          // to flip, and the relay's own `settled` promise has already won.
          if (request.signal.aborted) return null;

          const content = buildApprovalCardPrompt({
            seq: request.seq,
            toolName: request.toolName,
            reason: request.reason,
          });

          let created: DingtalkCardCreateResult;
          try {
            created = await deps.createCard(config, request.approvalId, {
              conversationKey: conversation.key,
              conversationKind: conversation.kind,
            }, content);
          } catch (error) {
            // Send failure -> null, never a throw: messaging-core degrades
            // straight to its text protocol on the same channel (plan §5's
            // "卡片发送失败（API 报错） -> 降级为文字兜底同一条消息").
            deps.log?.(`amiba-connector-dingtalk: createCard failed: ${String(error)}`);
            return null;
          }

          // The connect was torn down while the card was in flight (its
          // POST awaited across a `stop()`). Nothing will ever settle an
          // entry registered now — `stop()` already ran its own sweep —
          // so this falls back to null exactly as a send failure would,
          // rather than leaving an orphaned pending entry (and a stale card
          // sitting in the conversation) behind.
          if (stopped) return null;

          return new Promise<CardApprovalReply | null>((resolve) => {
            const entry: PendingApproval = {
              cardInstanceId: created.cardInstanceId,
              conversationKey: conversation.key,
              canAnswer: (sender) => request.canAnswer(sender),
              resolve,
            };
            pendingApprovals.set(request.approvalId, entry);

            // The card IS in the conversation now, so both abort paths
            // below abandon rather than resolve — see
            // `abandonPendingApproval`: the question was settled elsewhere
            // and `announceApprovalOutcome` still has to flip this card.
            if (request.signal.aborted) {
              abandonPendingApproval(entry);
              return;
            }
            const onAbort = () => abandonPendingApproval(entry);
            request.signal.addEventListener("abort", onAbort, { once: true });
            entry.detachAbort = () => request.signal.removeEventListener("abort", onAbort);
          });
        },
        async announceApprovalOutcome(_conversation, notice) {
          const entry = pendingApprovals.get(notice.approvalId);
          // Only ever called for an approval this same runtime's
          // `requestApproval` displayed successfully (contract, see
          // `ConnectorRuntime.announceApprovalOutcome`'s doc comment in
          // connector-core) — a missing entry means `stop()` already swept
          // it, which is a benign race, not a bug: nothing left to update.
          if (!entry) return;
          pendingApprovals.delete(notice.approvalId);

          if (!deps.updateCard) return;
          const content = buildApprovalCardSettled({
            seq: notice.seq,
            toolName: notice.toolName,
            outcome: notice.outcome,
            reason: notice.reason,
          });
          try {
            await deps.updateCard(config, entry.cardInstanceId, content);
          } catch (error) {
            // Errors logged, never thrown: the approval is already decided
            // by the time this runs, so there is nothing left to fall back
            // to (plan §4/§5 — the settled card just stays on its pending
            // face if the update call fails).
            deps.log?.(`amiba-connector-dingtalk: updateCard failed: ${String(error)}`);
          }
        },
      };
      return runtime;
    },

    capabilities: (config: unknown): CapabilityDecl[] =>
      buildCapabilities(dingtalkConfigSchema.parse(config)),
  };
}

// ---------------------------------------------------------------------------
// realDingtalkDeps — the only section of this file that touches the
// `dingtalk-stream` (2.1.6-beta.1) surface. Every call shape below was
// verified against the installed package's type declarations and, for the
// event-name question, its compiled `dist/client.cjs` (the `.d.ts` doesn't
// expose emitted event names) — see task-2-report.md for the full trail:
//
//   - constructor: the installed `client.d.ts` types the constructor's `opts`
//     as `{ clientId, clientSecret, ua?, keepAlive?, debug? }` — no
//     `autoReconnect` field, even though `DWClientConfig` (the *stored*
//     config type) has one. Passing `autoReconnect: true` in the object
//     literal below would therefore be a TS excess-property error. It's
//     omitted rather than cast away: `dist/client.cjs`'s `defaultConfig`
//     already sets `autoReconnect: true` unconditionally (spread before the
//     caller's own opts), so the behavior is identical either way.
//   - registration: `client.registerCallbackListener(TOPIC_ROBOT, cb)` where
//     `cb: (msg: DWClientDownStream) => void` — `msg.data` is the JSON
//     string payload (`DWClientDownStream.data: string`), `msg.headers
//     .messageId: string` is the ack token. Both confirmed directly against
//     `client.d.ts`'s `DWClientDownStream` interface.
//   - ack shape: `client.socketCallBackResponse(messageId: string, result:
//     any): void` — `result`'s type is `any` in the installed declarations,
//     and the compiled impl (`dist/client.cjs`) just wraps it verbatim as
//     `{ response: result }` before sending, so `{ status: "SUCCESS" }`
//     (matching the SDK's own internal `EventAckData` shape used for the
//     sibling `registerAllEventListener` path) is a safe, self-consistent
//     choice. The ack fires in a `finally` so a slow or throwing handler
//     never delays it — the platform retries delivery up to 60s otherwise.
//   - reconnect/disconnect events: grepped `dist/client.cjs` for every
//     `.emit(` call. There is exactly ONE: `onCallback()`'s `this.emit(
//     message.headers.topic, message)`, which exists solely to dispatch
//     CALLBACK-topic frames (e.g. TOPIC_ROBOT) to `registerCallbackListener`
//     handlers via the class's own `EventEmitter` base — it is not a
//     connection-status event at all. No "connected" / "disconnected" /
//     "reconnecting" / "reconnected" (or similarly named) event is ever
//     emitted anywhere in the class. Connection state instead lives only in
//     plain boolean fields (`connected`, `reconnecting`, `registered`) that
//     the SDK mutates internally with no change notification. Per the
//     explicit instruction to document this rather than poll those fields,
//     `DingtalkClientHandlers.onDown` is simply never invoked from real deps
//     below — it stays wired on the seam (and exercised by the fake-deps
//     test suite) for a future SDK version, or a differently-sourced signal,
//     to use without a shape change.
//   - token exchange: `GET_TOKEN_URL` (`https://oapi.dingtalk.com/gettoken`)
//     is the classic corp-app token endpoint, `GET ?appkey=&appsecret=` ->
//     `{ errcode, errmsg, access_token, expires_in }` with `errcode !== 0`
//     signaling failure — used here purely to validate the credentials
//     without persisting the returned token (the Stream Mode client and the
//     session-webhook POSTs below don't need it).
// ---------------------------------------------------------------------------

interface DingtalkTokenResponse {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
}

interface DingtalkWebhookResponse {
  errcode?: number;
  errmsg?: string;
}

/**
 * Parses one downstream socket frame's `data` string and dispatches it to
 * `onRobotMessage`, containing any failure instead of letting it escape.
 *
 * Verified: the SDK's dispatch chain (`onDownStream` -> `onCallback` ->
 * `EventEmitter.emit` -> this callback, all in `dist/client.cjs`) has no
 * `try`/`catch` anywhere on the path to `registerCallbackListener`
 * callbacks. Before this function existed, a single malformed frame's
 * `JSON.parse` `SyntaxError` — or a throw from inside `onRobotMessage`
 * itself — would propagate all the way out as an uncaught exception,
 * crashing the whole Electron main process over one bad frame. Exported so
 * every case (malformed JSON, a throwing handler, valid JSON) is directly
 * unit-testable without going through the real `DWClient`.
 */
export function handleRobotFrame(
  rawData: unknown,
  handlers: Pick<DingtalkClientHandlers, "onRobotMessage">,
  log?: (msg: string) => void,
): void {
  try {
    const parsed = JSON.parse(rawData as string) as unknown;
    handlers.onRobotMessage(parsed);
  } catch (error) {
    log?.(`amiba-connector-dingtalk: malformed or unhandleable stream frame: ${String(error)}`);
  }
}

/**
 * Same parse+dispatch shape as `handleRobotFrame` above, for the card
 * (`TOPIC_CARD`) callback topic instead of the robot-message one — see that
 * function's doc comment for why this exists (a malformed frame or a
 * throwing handler must never become an uncaught exception in the Electron
 * main process) and `realDingtalkDeps.createClient`'s doc comment for why
 * TWO separate `registerCallbackListener` registrations, one per topic, are
 * both required (the SDK dispatches by topic; there is no single "any
 * callback" registration).
 */
export function handleCardFrame(
  rawData: unknown,
  handlers: Pick<DingtalkClientHandlers, "onCardCallback">,
  log?: (msg: string) => void,
): void {
  try {
    const parsed = JSON.parse(rawData as string) as unknown;
    handlers.onCardCallback(parsed);
  } catch (error) {
    log?.(`amiba-connector-dingtalk: malformed or unhandleable card callback frame: ${String(error)}`);
  }
}

/**
 * Fetches a fresh corp-app access token for use as the
 * `x-acs-dingtalk-access-token` header on the card OpenAPI calls below.
 * Deliberately separate from `token()` above (which discards the token —
 * it exists purely to validate credentials at connect-creation time): this
 * one is called on every `createCard`/`updateCard`, un-cached, since
 * neither is a hot path (one card per approval, one update per settlement)
 * and DingTalk's own token endpoint is designed for frequent, cheap calls
 * (a corp's token is valid for ~2h and re-issuing early is a no-op
 * server-side). Not part of the `DingtalkDeps` seam — it's an
 * implementation detail of the real card calls, invisible to fakes.
 */
async function fetchDingtalkAccessToken(config: DingtalkConnectorConfig): Promise<string> {
  const url = `${GET_TOKEN_URL}?appkey=${encodeURIComponent(config.clientId)}&appsecret=${encodeURIComponent(config.clientSecret)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`dingtalk_token_http_${response.status}`);
  }
  const body = (await response.json()) as DingtalkTokenResponse;
  if (body.errcode || !body.access_token) {
    throw new Error(body.errmsg ?? `dingtalk_token_failed:${body.errcode ?? "no_access_token"}`);
  }
  return body.access_token;
}

/** `openSpaceId` addresses WHERE a card platform call lands — DingTalk's own
 * concept, distinct from the robot-message `conversationId`/session-webhook
 * addressing `deliver` uses above. Best-effort reconstruction, unverified
 * against a live call — see `realDingtalkDeps.createCard`'s doc comment. */
function cardOpenSpaceId(target: DingtalkCardTarget): string {
  return target.conversationKind === "group"
    ? `dtv1.card//IM_GROUP.${target.conversationKey}`
    : `dtv1.card//IM_ROBOT.${target.conversationKey}`;
}

const CARD_INSTANCES_URL = "https://api.dingtalk.com/v1.0/card/instances";

interface DingtalkCardApiResponse {
  success?: boolean;
  code?: string;
  message?: string;
}

export const realDingtalkDeps: DingtalkDeps = {
  createClient(config, handlers): DwLike {
    const client = new DWClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    client.registerCallbackListener(TOPIC_ROBOT, (msg: DWClientDownStream) => {
      try {
        handleRobotFrame(msg.data, handlers, realDingtalkDeps.log);
      } finally {
        client.socketCallBackResponse(msg.headers.messageId, { status: "SUCCESS" });
      }
    });

    // Registered unconditionally, alongside TOPIC_ROBOT, rather than only
    // when `config.approvalCardTemplateId` is set: a connect can gain a
    // template later without a restart being required to start receiving
    // its callbacks, and an unrecognized frame (no matching pending entry)
    // is already a silent no-op in `onCardCallback` above regardless.
    client.registerCallbackListener(TOPIC_CARD, (msg: DWClientDownStream) => {
      try {
        handleCardFrame(msg.data, handlers, realDingtalkDeps.log);
      } finally {
        client.socketCallBackResponse(msg.headers.messageId, { status: "SUCCESS" });
      }
    });

    return {
      connect: () => client.connect(),
      disconnect: () => client.disconnect(),
      isConnected: () => client.connected,
    };
  },

  async token(config): Promise<void> {
    const url = `${GET_TOKEN_URL}?appkey=${encodeURIComponent(config.clientId)}&appsecret=${encodeURIComponent(config.clientSecret)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      throw new Error(`dingtalk_token_http_${response.status}`);
    }
    const body = (await response.json()) as DingtalkTokenResponse;
    if (body.errcode) {
      throw new Error(body.errmsg ?? `dingtalk_token_failed:${body.errcode}`);
    }
  },

  async postWebhook(url, body): Promise<void> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`dingtalk_webhook_http_${response.status}`);
    }
    const payload = (await response.json()) as DingtalkWebhookResponse;
    if (payload.errcode) {
      throw new Error(payload.errmsg ?? `dingtalk_webhook_failed:${payload.errcode}`);
    }
  },

  // ---------------------------------------------------------------------
  // createCard / updateCard — DingTalk's card-instance OpenAPI, reached
  // directly over `fetch` exactly the way `postWebhook` above reaches the
  // session-webhook API: the `dingtalk-stream` SDK has NO send-side card
  // method at all. Verified by grepping the installed
  // `dingtalk-stream@2.1.6-beta.1` package's every compiled `.d.ts`
  // (`dist/*.d.ts`) for "card": the only hit is the `TOPIC_CARD` *callback*
  // topic constant re-exported from `constants.d.ts` — `DWClient`'s own
  // method list (`client.d.ts`, reproduced in the block comment further up
  // this file) has nothing named `sendCard`/`createCardInstance`/
  // `updateCardInstance`/similar.
  //
  // UNVERIFIED beyond that: the exact request/response body below is a
  // best-effort reconstruction from DingTalk's own OpenAPI docs
  // (open.dingtalk.com's "创建并投放卡片"/"卡片更新" pages) and public
  // examples (github.com/open-dingtalk/dingtalk-card-examples,
  // dingtalk-tutorial-go's bot_card_callback), not something pinned against
  // a literal response body the way `postWebhook`'s was — DingTalk's own doc
  // site renders its API reference client-side (a React SPA loaded from
  // g.alicdn.com), so neither `curl` nor an automated fetch could extract a
  // literal JSON schema from it; only the page's static section titles
  // (confirming the endpoints exist, roughly matching the shape below) came
  // back. See task-4-report.md's "card API" section for the full trail.
  // Both methods are optional on `DingtalkDeps` and any rejection is caught
  // by the caller (`requestApproval` -> `null`, `announceApprovalOutcome`
  // -> logged) specifically because of this: a wrong body shape degrades to
  // the text fallback rather than crashing anything. A real DingTalk app
  // with a provisioned card template is required to confirm or correct
  // this against a live call.
  // ---------------------------------------------------------------------

  async createCard(config, approvalId, target, content) {
    if (!config.approvalCardTemplateId) {
      // No card template provisioned for this connect — see
      // `DingtalkConnectorConfig.approvalCardTemplateId`'s doc comment.
      // Nothing to send; the caller (`requestApproval`) catches this and
      // returns `null`.
      throw new Error("dingtalk_approval_card_template_id_missing");
    }
    const accessToken = await fetchDingtalkAccessToken(config);
    // Our own idempotency/tracking id rather than one trusted out of the
    // create response body (see the UNVERIFIED note above) — it becomes the
    // `cardInstanceId` handed back to the caller, and `updateCard` below
    // addresses this same instance by it again as `outTrackId`.
    const outTrackId = `amiba-approval-${approvalId}`;
    const response = await fetch(CARD_INSTANCES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-acs-dingtalk-access-token": accessToken,
      },
      body: JSON.stringify({
        cardTemplateId: config.approvalCardTemplateId,
        outTrackId,
        callbackType: "STREAM",
        cardData: {
          cardParamMap: {
            approvalId,
            header: content.header,
            body: content.body,
            agreeLabel: content.agree.label,
            rejectLabel: content.reject.label,
          },
        },
        openSpaceId: cardOpenSpaceId(target),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`dingtalk_card_create_http_${response.status}`);
    }
    const body = (await response.json()) as DingtalkCardApiResponse;
    if (body.success === false) {
      throw new Error(body.message ?? `dingtalk_card_create_failed:${body.code ?? "unknown"}`);
    }
    return { cardInstanceId: outTrackId };
  },

  async updateCard(config, cardInstanceId, content): Promise<void> {
    const accessToken = await fetchDingtalkAccessToken(config);
    const response = await fetch(CARD_INSTANCES_URL, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-acs-dingtalk-access-token": accessToken,
      },
      body: JSON.stringify({
        outTrackId: cardInstanceId,
        cardUpdateOptions: { updateCardDataByKey: true },
        cardData: {
          cardParamMap: {
            header: content.header,
            body: content.body,
            statusLine: content.statusLine,
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`dingtalk_card_update_http_${response.status}`);
    }
    const body = (await response.json()) as DingtalkCardApiResponse;
    if (body.success === false) {
      throw new Error(body.message ?? `dingtalk_card_update_failed:${body.code ?? "unknown"}`);
    }
  },

  log: (msg) => {
    // Real deployment default: no other logging sink is wired through the
    // deps seam yet, so this is the one place in the file allowed to touch
    // console — everything above calls `deps.log?.(...)` instead.
    // eslint-disable-next-line no-console
    console.error(msg);
  },
};
