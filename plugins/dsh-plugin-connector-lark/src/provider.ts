import {
  Client,
  Domain,
  EventDispatcher,
  WSClient,
  registerApp as sdkRegisterApp,
} from "@larksuiteoapi/node-sdk";
import type {
  CapabilityDecl,
  ConnectorHandle,
  ConnectorInboundEnvelope,
  ConnectorProvider,
  ConnectorRuntime,
  ConnectorStatus,
  OnboardHandle,
  OnboardResult,
} from "@amiba/dsh-plugin-connector-core";

import {
  buildApprovalCard,
  buildSettledCard,
} from "./approval-card.js";
import {
  larkConfigSchema,
  translateCardAction,
  translateReceiveEvent,
  type LarkCardActionEvent,
  type LarkConnectorConfig,
  type LarkReceiveEvent,
} from "./translate.js";

/**
 * Status/event callbacks the provider core wires up when constructing a WS
 * connection. `realLarkDeps.createWsClient` maps these onto the SDK's own
 * `IConstructorParams` callbacks and the registered event-dispatcher
 * handler — the provider core itself never touches SDK types directly.
 */
export interface LarkWsCallbacks {
  onReady?: () => void;
  onError?: (err: unknown) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  /** Raw im.message.receive_v1 payload; deps registers this on the dispatcher. */
  onEvent?: (event: LarkReceiveEvent) => void | Promise<void>;
  /**
   * Raw card.action.trigger (v2) payload — a click on one of
   * `buildApprovalCard`'s two buttons, or on any other card this connect
   * ever sent. Delivered over the SAME WS long connection as `onEvent`
   * (confirmed via the installed SDK: `LarkChannel`'s own dispatcher
   * registers `'card.action.trigger'` on the identical low-level
   * `EventDispatcher` class this provider already uses for
   * `im.message.receive_v1` — see the `realLarkDeps.createWsClient`
   * verification comment below), so no second connection or `LarkChannel`
   * rewrite is needed to receive it.
   */
  onCardAction?: (event: LarkCardActionEvent) => void | Promise<void>;
}

/** Thin seam over `WSClient` — only what the provider core needs. */
export interface WsLike {
  start(): Promise<void>;
  close(params?: { force?: boolean }): void;
}

/** Thin seam over the HTTP `Client`, hiding every SDK call shape behind a handful of verbs. */
export interface ApiLike {
  /** Exchanges a tenant access token; rejects with the SDK's error message on auth failure. */
  tenantToken(): Promise<void>;
  botOpenId(): Promise<string>;
  /** Plain-text message. Kept as `runtime.deliver()`'s fallback when `sendCard` rejects. */
  sendText(chatId: string, text: string): Promise<void>;
  /** Interactive-card message rendering `markdown` — Feishu text messages don't render markdown. */
  sendCard(chatId: string, markdown: string): Promise<void>;
  /** Adds a reaction to `messageId`; resolves with the reaction id (needed to remove it later). */
  addReaction(messageId: string, emoji: string): Promise<string>;
  removeReaction(messageId: string, reactionId: string): Promise<void>;
  /**
   * Sends a Lark card v2 payload (`buildApprovalCard`'s output) and returns
   * the `message_id` Lark assigned — needed so `updateInteractiveCard` can
   * later flip the same card to its settled state. Distinct from `sendCard`
   * (which renders `deliver()`'s markdown text and discards the id): the
   * approval flow always needs the id back, `deliver()` never does.
   */
  sendInteractiveCard(chatId: string, card: object): Promise<{ messageId: string }>;
  /** Replaces an already-sent card's content in place (`im.message.patch`). */
  updateInteractiveCard(messageId: string, card: object): Promise<void>;
}

/**
 * Narrow local mirror of the SDK's `RegisterAppOptions` — only the fields
 * `provider.onboard()` actually passes. Structurally assignable to the
 * SDK's real type (verified against the installed 1.73.0 declarations, see
 * `realLarkDeps.registerApp` below), so fakes in tests never need to import
 * SDK types either.
 */
export interface LarkRegisterAppOptions {
  signal?: AbortSignal;
  onQRCodeReady: (info: { url: string; expireIn: number }) => void;
  onStatusChange?: (info: { status: string; interval?: number }) => void;
  appPreset?: { name?: string; desc?: string };
  addons?: {
    scopes?: { tenant?: string[] };
    events?: { items?: { tenant?: string[] } };
  };
}

/** Narrow local mirror of the SDK's `RegisterAppResult`. */
export interface LarkRegisterAppResult {
  client_id: string;
  client_secret: string;
  user_info?: { open_id?: string; tenant_brand?: "feishu" | "lark" };
}

export interface LarkDeps {
  createWsClient(config: LarkConnectorConfig, callbacks: LarkWsCallbacks): WsLike;
  createApiClient(config: LarkConnectorConfig): ApiLike;
  /** Runs the SDK's scan-to-register device-authorization flow; see `provider.onboard()`. */
  registerApp(options: LarkRegisterAppOptions): Promise<LarkRegisterAppResult>;
  /**
   * Console-free logging seam: the provider core never calls `console.*`
   * directly. A swallowed `handle.onInbound` error is still observable
   * through this instead of hard-crashing the ws loop. Optional so fakes in
   * tests can omit it (the swallow just becomes silent).
   */
  log?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// capabilities() — the two tool surfaces this connector offers a mounted
// agent: an MCP server (lark-mcp, read+write Lark/Feishu API tools) and a CLI
// provisioning spec (lark-cli, curated read-oriented Agent Skills). Both
// version strings below were verified against the published registry at
// implementation time (`npm view <pkg> version`) rather than left floating,
// so a later `npx -y <pkg>@latest`/`npm install <pkg>@latest` drift can't
// silently change tool behavior underneath an existing connect:
//   - @larksuiteoapi/lark-mcp  → 0.5.1 (pinned into the npx arg itself, since
//     `ManagedMcpServer` has no separate version field)
//   - @larksuite/cli           → 1.0.92 (CliProvisionSpec.pinnedVersion)
//
// Credential channel (verified, not assumed): lark-mcp's installed dist
// (`dist/utils/constants.js`, `OAPI_MCP_ENV_ARGS`) reads
// `process.env.APP_ID` / `process.env.APP_SECRET` (plus USER_ACCESS_TOKEN /
// LARK_TOKEN_MODE / LARK_TOOLS / LARK_DOMAIN) and merges them under the `mcp`
// command's own `-a`/`-s`/... flags — so credentials are passed via `env`
// here and never appear in `args`, keeping them out of `ps`/process-list
// visibility. (If a future lark-mcp version dropped env support, the
// fallback would be appending `-a <appId> -s <appSecret>` to args instead —
// deliberately NOT done here since it would put secrets in `ps aux` output
// for every local user on the machine.)
// ---------------------------------------------------------------------------

/**
 * Read-oriented Agent Skills curated from `@larksuite/cli`'s published
 * skill set (docs/wiki/search flavored — see the package README's "Agent
 * Skills" table for the full 23-skill list). Deliberately excludes
 * message-sending, task/approval-mutation, and other write-flavored skills:
 * this connector mounts the CLI for the agent's own tool-use, and a
 * conservative default keeps write actions opt-in rather than ambient.
 */
const LARK_CLI_SKILLS: readonly string[] = [
  "lark-doc", // Create, read, update, search documents (Markdown-based)
  "lark-wiki", // Knowledge spaces, nodes, documents
  "lark-drive", // Upload, download files, manage permissions & comments
  "lark-openapi-explorer", // Explore underlying APIs from official docs
  "lark-contact", // Search users by name/email/phone, get user profiles
];

const LARK_MCP_PACKAGE = "@larksuiteoapi/lark-mcp";
const LARK_MCP_PINNED_VERSION = "0.5.1";
const LARK_CLI_PINNED_VERSION = "1.0.92";

function buildCapabilities(config: LarkConnectorConfig): CapabilityDecl[] {
  return [
    {
      kind: "mcp",
      spec: {
        serverName: "lark",
        transport: "stdio",
        command: "npx",
        args: [
          "-y",
          `${LARK_MCP_PACKAGE}@${LARK_MCP_PINNED_VERSION}`,
          "mcp",
          "-t",
          "preset.light",
          ...(config.domain === "lark"
            ? ["--domain", "https://open.larksuite.com"]
            : []),
        ],
        env: {
          APP_ID: config.appId,
          APP_SECRET: config.appSecret,
        },
        enabled: true,
      },
    },
    {
      kind: "cli",
      spec: {
        id: "lark",
        package: "@larksuite/cli",
        binary: "lark-cli",
        minVersion: "1.0.0",
        pinnedVersion: LARK_CLI_PINNED_VERSION,
        env: {
          LARKSUITE_CLI_APP_ID: config.appId,
          LARKSUITE_CLI_APP_SECRET: config.appSecret,
        },
        skills: [...LARK_CLI_SKILLS],
      },
    },
  ];
}

/** `translateReceiveEvent`'s return type is structurally a `ConnectorInboundEnvelope`. */
function toEnvelope(
  event: LarkReceiveEvent,
  botOpenId: string,
): ConnectorInboundEnvelope | null {
  return translateReceiveEvent(event, botOpenId) as ConnectorInboundEnvelope | null;
}

/**
 * Lark/Feishu `ConnectorProvider`: runs the official WS long connection,
 * translates inbound `im.message.receive_v1` events into
 * `ConnectorInboundEnvelope`s, and delivers outbound text via the HTTP API.
 * `capabilities()` declares the two M2b tool surfaces (lark-mcp, lark-cli) —
 * see `buildCapabilities()` below for the verification trail.
 */
export function createLarkProvider(deps: LarkDeps = realLarkDeps): ConnectorProvider {
  return {
    id: "lark",
    name: "飞书 / Lark",
    description: "Lark/Feishu bot over the official WebSocket long connection.",
    configSchema: larkConfigSchema,

    async validate(config: unknown): Promise<void> {
      const parsed = larkConfigSchema.parse(config);
      const api = deps.createApiClient(parsed);
      await api.tenantToken();
    },

    async start(handle: ConnectorHandle): Promise<ConnectorRuntime> {
      const config = larkConfigSchema.parse(handle.config);
      // "constructing" — the ws connection is about to be built.
      handle.setStatus({ state: "connecting" });

      const api = deps.createApiClient(config);
      const botOpenId = await api.botOpenId();

      // Declared before the callbacks below (not after `ws.start()`) so
      // every callback closure — including one that could in principle fire
      // synchronously during construction — sees a real `false`, never a
      // TDZ reference. `stop()` flips this to true and every callback below
      // checks it first: a callback racing a torn-down connect (stop()
      // already resolved, the center already deleted its status entry)
      // must not resurrect a status, or deliver an inbound message, for a
      // connect that no longer exists.
      let stopped = false;
      const safeSetStatus = (status: ConnectorStatus): void => {
        if (stopped) return;
        handle.setStatus(status);
      };

      // Per-start "typing" reaction ledger: inbound message_id -> the
      // reaction_id `addReaction` returned for it, so `deliver()` can remove
      // the right reaction once the reply for that message goes out. Never
      // read across a stop()/start() cycle — `stop()` clears it outright.
      const reactions = new Map<string, string>();

      // Per-start approval-card ledgers, both keyed by `approvalId` and
      // cleared wholesale on `stop()` (same lifecycle as `reactions`):
      //  - `cardMessages` remembers the `message_id` `sendInteractiveCard`
      //    returned, so `announceApprovalOutcome` — called well after the
      //    click (or timeout, or never) — can still find the card to patch.
      //    Populated in `requestApproval` on a successful send; consumed
      //    (read + deleted) in `announceApprovalOutcome`, which is the only
      //    guaranteed-eventually-called hook for a natively presented
      //    question (messaging-core's contract — see `types.ts`), so it is
      //    also this ledger's sole cleanup point besides `stop()`.
      //  - `pendingClicks` holds the `settle` for the promise
      //    `requestApproval` is currently awaiting, plus that request's own
      //    `canAnswer` gate, so the WS card-action handler below can check
      //    who clicked before settling it. Removed the moment it is used
      //    (matched, allowed click) or made moot (the request's own `signal`
      //    aborts) — never left around for a second click to find.
      const cardMessages = new Map<string, string>();
      const pendingClicks = new Map<
        string,
        {
          settle(
            reply: { outcome: "allowed-once" | "rejected"; by?: string } | null,
          ): void;
          canAnswer(sender: string | undefined): Promise<boolean>;
        }
      >();

      const ws = deps.createWsClient(config, {
        onReady: () => safeSetStatus({ state: "ready" }),
        onReconnected: () => safeSetStatus({ state: "ready" }),
        onReconnecting: () => safeSetStatus({ state: "connecting" }),
        onError: (err) => safeSetStatus({ state: "error", detail: String(err) }),
        onEvent: async (event) => {
          if (stopped) return;
          const envelope = toEnvelope(event, botOpenId);
          if (!envelope) return;

          // Fire-and-forget "typing" reaction: never awaited before
          // onInbound (must not delay message routing) and never allowed to
          // throw into the ws loop. A late resolution after stop() must not
          // resurrect the ledger for a connect that's already torn down.
          const inboundMessageId = envelope.id;
          api
            .addReaction(inboundMessageId, "Typing")
            .then((reactionId) => {
              if (!stopped) reactions.set(inboundMessageId, reactionId);
            })
            .catch((error) => {
              deps.log?.(
                `amiba-connector-lark: addReaction failed for ${inboundMessageId}: ${String(error)}`,
              );
            });

          try {
            await handle.onInbound(envelope);
          } catch (error) {
            // Handler errors must never crash the ws loop — swallow and log.
            deps.log?.(
              `amiba-connector-lark: handle.onInbound failed: ${String(error)}`,
            );
          }
        },
        onCardAction: (event) => {
          if (stopped) return;
          const click = translateCardAction(event);
          if (!click) return; // not a recognizable approval-button click
          // Cross-check against the card THIS approval actually sent —
          // rejects a stale click replayed against a card that has since
          // been superseded (a different approvalId happened to reuse the
          // same chat) as well as a genuinely unrelated card's click that
          // happened to carry an `{approvalId, decision}`-shaped value.
          if (cardMessages.get(click.approvalId) !== click.messageId) {
            deps.log?.(
              `amiba-connector-lark: ignoring a card action for approval ${click.approvalId}: it came from ${click.messageId}, not the card this connect sent`,
            );
            return;
          }
          const pending = pendingClicks.get(click.approvalId);
          if (!pending) {
            // Already settled by another path, or a second click on a card
            // whose result face hasn't landed yet (plan §5).
            deps.log?.(
              `amiba-connector-lark: ignoring a card action for approval ${click.approvalId}: nothing is waiting on it any more`,
            );
            return;
          }
          // Who may answer is the caller's rule, not this connector's:
          // `canAnswer` is messaging-core's `allowedSenders` narrowed by
          // connector-core's owners/pairing gate, both re-read at click
          // time. `operator.open_id` is the same identity space inbound
          // messages carry as `sender`, so the two agree (plan §2). Async,
          // hence the detached task — the WS ack does not wait on it.
          void (async () => {
            let allowed = false;
            try {
              allowed = await pending.canAnswer(click.operatorOpenId);
            } catch (error) {
              deps.log?.(
                `amiba-connector-lark: could not check who may answer approval ${click.approvalId}: ${String(error)}`,
              );
            }
            if (!allowed) {
              // Ignored, NOT settled and NOT acknowledged on the card: the
              // question keeps waiting for someone who may answer it
              // (plan §5「回调来自不允许的发送者 → 忽略并记 warn，不结算」).
              deps.log?.(
                `amiba-connector-lark: ignoring approval ${click.approvalId} clicked by ${click.operatorOpenId}: that operator may not answer it`,
              );
              return;
            }
            if (stopped) return;
            // Re-read after the await: another click (or an abort) may have
            // settled this question while the gate was in flight.
            const current = pendingClicks.get(click.approvalId);
            if (current !== pending) return;
            current.settle({ outcome: click.decision, by: click.operatorOpenId });
          })();
        },
      });

      await ws.start();

      const runtime: ConnectorRuntime = {
        async stop(): Promise<void> {
          if (stopped) return;
          stopped = true;
          // Lingering reactions are harmless (the keyboard emoji just stays
          // on the last inbound message) — never worth a network round trip
          // during shutdown, so just drop the ledger and stay fast/idempotent.
          reactions.clear();
          // Any promise `requestApproval` callers are still awaiting is
          // simply abandoned here (never resolved) — exactly what the
          // `ConnectorRuntime.requestApproval` contract allows for a
          // question settled by another path; messaging-core's own
          // `dispose()` already resolves the OUTER question as `cancelled`
          // when this plugin unloads, so nothing is left hanging above this
          // layer either.
          cardMessages.clear();
          pendingClicks.clear();
          ws.close({ force: false });
        },
        async deliver(conversation, envelope): Promise<void> {
          // Best-effort: clear the "typing" reaction left on the message
          // this reply answers, if any is still on file. A removal failure
          // must never block the reply itself.
          const reactionId = reactions.get(envelope.inReplyTo);
          if (reactionId !== undefined) {
            reactions.delete(envelope.inReplyTo);
            try {
              await api.removeReaction(envelope.inReplyTo, reactionId);
            } catch (error) {
              deps.log?.(
                `amiba-connector-lark: removeReaction failed for ${envelope.inReplyTo}: ${String(error)}`,
              );
            }
          }

          // Markdown only renders through an interactive card — plain text
          // messages render Lark/Feishu markdown syntax literally. Fall back
          // to sendText on any card-send rejection (e.g. a schema mismatch)
          // so a reply is never lost to a formatting error; a fallback
          // failure still propagates so the messaging outbox retries.
          try {
            await api.sendCard(conversation.key, envelope.text);
          } catch (error) {
            deps.log?.(
              `amiba-connector-lark: sendCard failed, falling back to sendText: ${String(error)}`,
            );
            await api.sendText(conversation.key, envelope.text);
          }
        },
        // ---------------------------------------------------------------
        // requestApproval / announceApprovalOutcome — plan §1/§4:
        // `.worktable/im-approval/plan.md`. Both methods are typed
        // structurally against `ConnectorRuntime`'s own declaration in
        // `@amiba/dsh-plugin-connector-core` (which imports the real
        // `ApprovalPrompt`/`ApprovalReply`/`ApprovalOutcomeNotice` from
        // `@amiba/dsh-plugin-messaging-core`) — this file names none of
        // those three types directly, since this package only depends on
        // connector-core, never on messaging-core (see `approval-card.ts`'s
        // header comment for why that is fine: `request`/`notice` below are
        // checked against `buildApprovalCard`/`buildSettledCard`'s own
        // structural mirrors at the call site).
        //
        // Sender validation (plan §2/§5): a card in a group chat is
        // clickable by everyone who can see it, so `onCardAction` above
        // gates every click on `request.canAnswer` — the caller's own rule
        // (messaging-core's `channel.allowedSenders`, narrowed by
        // connector-core's `owners`/`pairing`), re-read at click time. This
        // provider never decides who may answer; it only asks, and forwards
        // the allowed operator's `open_id` as `ApprovalReply.by`.
        // ---------------------------------------------------------------
        async requestApproval(conversation, request) {
          const card = buildApprovalCard(request);
          let sent: { messageId: string };
          try {
            sent = await api.sendInteractiveCard(conversation.key, card);
          } catch (error) {
            deps.log?.(
              `amiba-connector-lark: sendInteractiveCard failed for approval ${request.approvalId}, falling back to text: ${String(error)}`,
            );
            return null;
          }
          if (stopped) {
            // `stop()` ran while the send was in flight: it already cleared
            // both ledgers, so registering the card now would leave an entry
            // nothing can ever settle or flip. The card itself is already in
            // the chat, though — retract it to its 「已取消」 face rather
            // than leaving live buttons that do nothing next to the text
            // prompt messaging-core is about to fall back to. Best effort:
            // a failure here only leaves the card as it was.
            try {
              await api.updateInteractiveCard(
                sent.messageId,
                buildSettledCard({
                  approvalId: request.approvalId,
                  seq: request.seq,
                  toolName: request.toolName,
                  outcome: "cancelled",
                  reason: "cancelled",
                }),
              );
            } catch (error) {
              deps.log?.(
                `amiba-connector-lark: could not retract the approval card for ${request.approvalId} after stop(): ${String(error)}`,
              );
            }
            return null;
          }
          cardMessages.set(request.approvalId, sent.messageId);

          return new Promise((resolve) => {
            const settleOnce = (
              reply: { outcome: "allowed-once" | "rejected"; by?: string } | null,
            ): void => {
              pendingClicks.delete(request.approvalId);
              request.signal.removeEventListener("abort", onAbort);
              resolve(reply);
            };
            // Wrap the caller's resolve so a matching click ALSO tears down
            // the abort listener — otherwise a request that gets answered
            // natively (the common case) would leak one listener per
            // approval for the lifetime of `request.signal`.
            pendingClicks.set(request.approvalId, {
              settle: settleOnce,
              canAnswer: (sender) => request.canAnswer(sender),
            });

            // Per the `ConnectorRuntime.requestApproval` contract: on
            // abort (the question was settled by another path — a text
            // reply, a timeout, the desktop) this must NOT resolve at all,
            // only stop waiting and let the card sit until
            // `announceApprovalOutcome` flips it. Just unregister so a
            // late click can no longer resolve an abandoned promise.
            function onAbort(): void {
              pendingClicks.delete(request.approvalId);
            }
            if (request.signal.aborted) {
              onAbort();
              return;
            }
            request.signal.addEventListener("abort", onAbort, { once: true });
          });
        },
        async announceApprovalOutcome(conversation, notice): Promise<void> {
          void conversation; // the card is addressed by messageId, not chat id
          const messageId = cardMessages.get(notice.approvalId);
          cardMessages.delete(notice.approvalId);
          pendingClicks.delete(notice.approvalId);
          if (!messageId) return; // nothing was ever sent natively for this one
          try {
            await api.updateInteractiveCard(messageId, buildSettledCard(notice));
          } catch (error) {
            deps.log?.(
              `amiba-connector-lark: updateInteractiveCard failed for approval ${notice.approvalId}: ${String(error)}`,
            );
          }
        },
      };
      return runtime;
    },

    capabilities: (config: unknown): CapabilityDecl[] =>
      buildCapabilities(larkConfigSchema.parse(config)),

    /**
     * Scan-to-connect onboarding: runs the SDK's device-authorization
     * `registerApp` flow, forwarding its QR/status callbacks onto the
     * handle as they fire, then maps the returned credentials into a
     * validated `LarkConnectorConfig`.
     *
     * `handle.signal` (the caller's own abort signal — never a locally
     * constructed one) is passed straight through to `registerApp`, so
     * cancelling the onboarding session unwinds the SDK's polling loop and
     * this call rejects; the center classifies cancelled-vs-error by
     * `signal.aborted`, so no local catch/translate is needed here.
     */
    async onboard(handle: OnboardHandle): Promise<OnboardResult> {
      const result = await deps.registerApp({
        signal: handle.signal,
        onQRCodeReady: ({ url, expireIn }) =>
          handle.emit({ kind: "qr", url, expireIn }),
        onStatusChange: ({ status }) =>
          handle.emit({ kind: "status", note: status }),
        appPreset: {
          name: "Amiba ({user})",
          desc: "Amiba desktop agent connect",
        },
        // Minimal read+send set for im.message.receive_v1 + reply, verified
        // against the SDK's own README examples: `im:message` ("发送和接收消息")
        // covers receiving the event, `im:message:send_as_bot` covers the
        // `client.im.message.create` call `runtime.deliver()` makes.
        addons: {
          scopes: { tenant: ["im:message", "im:message:send_as_bot"] },
          events: { items: { tenant: ["im.message.receive_v1"] } },
        },
      });

      const config = larkConfigSchema.parse({
        appId: result.client_id,
        appSecret: result.client_secret,
        domain: result.user_info?.tenant_brand === "lark" ? "lark" : "feishu",
      });

      // No pre-validation tenantToken() call here: createConnect validates
      // this same config via provider.validate() moments after this
      // resolves, which already makes that exact call.
      return { config };
    },
  };
}

// ---------------------------------------------------------------------------
// realLarkDeps — the only section of this file that touches the
// @larksuiteoapi/node-sdk (1.73.0) surface. Every call shape below was
// verified against the installed type declarations (and, where the SDK
// leaves an endpoint untyped, the official Feishu docs) — see
// task-4-report.md for the verification trail:
//   - tenant token: client.auth.tenantAccessToken.internal({ data: { app_id, app_secret } })
//   - bot identity: client.request({ method: "GET", url: "/open-apis/bot/v3/info" }) →
//     response.bot.open_id — NOT response.data.bot.open_id. This endpoint has no semantic
//     wrapper in the installed SDK (plain client.request), and the documented response
//     places `bot` at the top level alongside `code`/`msg`, with no `data` wrapper.
//   - send text: client.im.message.create({ params: { receive_id_type: "chat_id" }, data }) —
//     NOT client.im.v1.message.create. This SDK version flattens the im/v1/message resource
//     directly onto `client.im.message` (confirmed: no `im.v1` key exists in the type decls).
//   - send card: same client.im.message.create call, with msg_type: "interactive" and content
//     JSON.stringify'd from a card v2 payload ({ schema: "2.0", body: { elements: [{ tag:
//     "markdown", content }] } }) — the installed type decls leave `msg_type`/`content` as plain
//     `string`, so no cast is needed for the "interactive" literal.
//   - both `sendText` and `sendCard` check `res.code` and throw on a truthy value (fix round 1:
//     `sendText` originally didn't) — required because the SDK's shared axios response
//     interceptor only returns `resp.data` and never inspects `code` itself (confirmed in the
//     installed `lib/index.js`), so a 200 HTTP response carrying a non-zero business `code`
//     (bot removed from chat, permission revoked, invalid receive_id, content-moderation block,
//     rate limit, ...) would otherwise resolve silently. Without this check on BOTH verbs, a
//     `sendCard` failure of this class would fall back to a `sendText` call that hits the same
//     chat/account-level condition, also "succeeds" silently, and `runtime.deliver()` resolves
//     with the reply actually lost and the outbox never retrying.
//   - add reaction: client.im.messageReaction.create({ path: { message_id }, data:
//     { reaction_type: { emoji_type } } }) → response is always `{ code?, msg?, data?:
//     { reaction_id?, ... } }` per the installed type decls (reaction_id is NEVER top-level) —
//     confirmed by reading the decl directly. `sendCard`'s hedge (`res.data?.reaction_id ??
//     res.reaction_id`) is kept anyway as a defensive belt against future SDK/gateway drift,
//     mirroring the `botOpenId` precedent above.
//   - remove reaction: client.im.messageReaction.delete({ path: { message_id, reaction_id } })
//     — no `data` payload, same `{ code?, msg?, data? }` response shape.
//   - "typing" emoji: the string "Typing" is the emoji_type key for Feishu's keyboard (⌨️)
//     reaction — this file passes it as a plain string literal from `runtime.deliver()`'s
//     caller (the ws `onEvent` callback), never imported as an SDK enum (none exists for it).
//   - domain: config's "feishu"/"lark" strings must be mapped to the Domain enum
//     (Domain.Feishu = 0 / Domain.Lark = 1). Passing the raw string through would NOT work:
//     the SDK's `formatDomain` only special-cases the two enum values and otherwise uses the
//     given string verbatim as the base URL, so an unmapped "feishu"/"lark" string would be
//     used as a broken host.
//   - app registration: `registerApp(options): Promise<{ client_id, client_secret, user_info?:
//     { open_id?, tenant_brand?: "feishu" | "lark" } }>` — a top-level SDK export (not on
//     `Client`/`WSClient`), confirmed via the installed 1.73.0 type declarations
//     (`types/index.d.ts`, `RegisterAppOptions`/`RegisterAppResult`) and the SDK's own
//     README "App Registration" section. `options.signal` cancels the underlying polling
//     loop; `onQRCodeReady`/`onStatusChange` fire zero or more times before the promise
//     settles; `addons.scopes.tenant` / `addons.events.items.tenant` are additive
//     pre-fills on the platform's default app template shown on the confirm page — the
//     README documents `im:message` as "发送和接收消息" (send + receive messages) and
//     `im:message:send_as_bot` as "以机器人身份发送消息" (send as bot identity), which is
//     the minimal pair covering `im.message.receive_v1` plus the `client.im.message.create`
//     reply this provider's `runtime.deliver()` already makes.
// ---------------------------------------------------------------------------

function resolveDomain(domain: LarkConnectorConfig["domain"]): Domain {
  return domain === "lark" ? Domain.Lark : Domain.Feishu;
}

interface TenantTokenResponse {
  code?: number;
  msg?: string;
}

interface BotInfoResponse {
  code?: number;
  msg?: string;
  bot?: { open_id?: string };
  // This endpoint isn't in the SDK's typed surface (hence the raw
  // `client.request<BotInfoResponse>` call below) — some Lark/Feishu
  // gateway responses wrap the payload under `data` instead of at the top
  // level. Hedge against both shapes rather than assuming the untyped
  // top-level one.
  data?: { bot?: { open_id?: string } };
}

interface MessageCreateResponse {
  code?: number;
  msg?: string;
  data?: { message_id?: string };
}

/** `client.im.message.patch`'s response never carries a payload of its own —
 * `{ code?, msg?, data?: {} }` per the installed type decls. */
interface PatchMessageResponse {
  code?: number;
  msg?: string;
}

/**
 * Verified against the installed 1.73.0 type decls: `reaction_id` is always
 * under `data`, never top-level. The top-level `reaction_id` field here is a
 * defensive hedge only (see the SDK-verification comment block above), kept
 * for parity with the `botOpenId` precedent rather than because this
 * endpoint is known to ever respond that way.
 */
interface ReactionResponse {
  code?: number;
  msg?: string;
  reaction_id?: string;
  data?: { reaction_id?: string };
}

/** Card v2 payload for a single markdown element — see the SDK-verification
 * comment block above for why this schema (over v1's `lark_md`/`md` tags). */
function markdownCard(markdown: string): unknown {
  return {
    schema: "2.0",
    body: { elements: [{ tag: "markdown", content: markdown }] },
  };
}

export const realLarkDeps: LarkDeps = {
  createWsClient(config, callbacks): WsLike {
    // `card.action.trigger` is registered on the SAME low-level
    // `EventDispatcher` as `im.message.receive_v1` rather than switching
    // this provider to the SDK's higher-level `LarkChannel` wrapper. Two
    // things confirmed this is the right (least-invasive) call before
    // writing it, both from the installed 1.73.0 SDK itself:
    //   1. `EventDispatcher.register<T = {}>(handles: IHandles & T)` types
    //      `IHandles` (the built-in `im.*`/`drive.*`/... event names) but
    //      the generic `& T` still lets an extra key like
    //      `'card.action.trigger'` type-check — TS infers `T` from the
    //      literal. `IHandles` itself does not (and structurally cannot,
    //      per its own doc comment on `callbacks` vs `events`) list
    //      callback names.
    //   2. `LarkChannel` itself — the "do it properly" alternative floated
    //      in the task brief — is not a thin card-callback shim: reading
    //      its `registerDispatcherHandlers()` in `lib/index.js` shows it
    //      does exactly this same `new EventDispatcher(...).register({
    //      'im.message.receive_v1': ..., 'card.action.trigger': ..., ... })`
    //      call internally, then layers its OWN message-normalization,
    //      dedup/lock/queue safety pipeline, and policy engine on top —
    //      none of which this provider wants (it already has its own
    //      `translateReceiveEvent`, typing-reaction ledger, and markdown
    //      card fallback, all covered by the existing test suite).
    //      Adopting `LarkChannel` would mean replacing that whole
    //      provider, a much larger and riskier change than one more
    //      dispatcher key.
    // At the wire level a card click arrives as a WS "event" frame exactly
    // like `im.message.receive_v1` (`WSClient#handleEventData` in the
    // SDK's `lib/index.js` dispatches BOTH through the identical
    // `eventDispatcher.invoke(...)` call), so no second connection is
    // needed. Returning nothing from the handler below is a deliberate,
    // minimal ack (Lark ack's the click with a bare `{code:0}`, no toast);
    // the card is updated later, out of band, via `updateInteractiveCard`
    // once messaging-core calls `announceApprovalOutcome` — see
    // `provider.ts`'s `requestApproval`/`announceApprovalOutcome`.
    const dispatcher = new EventDispatcher({}).register({
      "im.message.receive_v1": (data) =>
        callbacks.onEvent?.(data as LarkReceiveEvent),
      "card.action.trigger": (data: unknown) =>
        callbacks.onCardAction?.(data as LarkCardActionEvent),
    });
    const ws = new WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: resolveDomain(config.domain),
      autoReconnect: true,
      onReady: callbacks.onReady,
      onError: (err: Error) => callbacks.onError?.(err),
      onReconnecting: callbacks.onReconnecting,
      onReconnected: callbacks.onReconnected,
    });
    return {
      start: () => ws.start({ eventDispatcher: dispatcher }),
      close: (params) => ws.close(params),
    };
  },

  createApiClient(config): ApiLike {
    const client = new Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: resolveDomain(config.domain),
    });
    return {
      async tenantToken(): Promise<void> {
        const res = await client.auth.tenantAccessToken.internal({
          data: { app_id: config.appId, app_secret: config.appSecret },
        }) as TenantTokenResponse;
        if (res.code) {
          throw new Error(res.msg ?? `lark_tenant_token_failed:${res.code}`);
        }
      },
      async botOpenId(): Promise<string> {
        const res = await client.request<BotInfoResponse>({
          method: "GET",
          url: "/open-apis/bot/v3/info",
        });
        const openId = (res.bot ?? res.data?.bot)?.open_id;
        if (!openId) {
          throw new Error(res.msg ?? "lark_bot_info_missing_open_id");
        }
        return openId;
      },
      async sendText(chatId, text): Promise<void> {
        const res = (await client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            msg_type: "text",
            content: JSON.stringify({ text }),
          },
        })) as MessageCreateResponse;
        if (res.code) {
          throw new Error(res.msg ?? `lark_send_text_failed:${res.code}`);
        }
      },
      async sendCard(chatId, markdown): Promise<void> {
        const res = (await client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            msg_type: "interactive",
            content: JSON.stringify(markdownCard(markdown)),
          },
        })) as MessageCreateResponse;
        if (res.code) {
          throw new Error(res.msg ?? `lark_send_card_failed:${res.code}`);
        }
      },
      async addReaction(messageId, emoji): Promise<string> {
        const res = (await client.im.messageReaction.create({
          path: { message_id: messageId },
          data: { reaction_type: { emoji_type: emoji } },
        })) as ReactionResponse;
        const reactionId = res.data?.reaction_id ?? res.reaction_id;
        if (!reactionId) {
          throw new Error(res.msg ?? "lark_add_reaction_missing_reaction_id");
        }
        return reactionId;
      },
      async removeReaction(messageId, reactionId): Promise<void> {
        const res = (await client.im.messageReaction.delete({
          path: { message_id: messageId, reaction_id: reactionId },
        })) as ReactionResponse;
        if (res.code) {
          throw new Error(res.msg ?? `lark_remove_reaction_failed:${res.code}`);
        }
      },
      async sendInteractiveCard(chatId, card): Promise<{ messageId: string }> {
        const res = (await client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            msg_type: "interactive",
            content: JSON.stringify(card),
          },
        })) as MessageCreateResponse;
        if (res.code) {
          throw new Error(res.msg ?? `lark_send_interactive_card_failed:${res.code}`);
        }
        const messageId = res.data?.message_id;
        if (!messageId) {
          throw new Error("lark_send_interactive_card_missing_message_id");
        }
        return { messageId };
      },
      async updateInteractiveCard(messageId, card): Promise<void> {
        // `im.message.patch` — 更新已发送的消息卡片 (update an already-sent
        // card in place). Distinct from `im.message.update` (text/post
        // only; its own SDK doc comment points here for cards).
        const res = (await client.im.message.patch({
          data: { content: JSON.stringify(card) },
          path: { message_id: messageId },
        })) as PatchMessageResponse;
        if (res.code) {
          throw new Error(res.msg ?? `lark_update_interactive_card_failed:${res.code}`);
        }
      },
    };
  },

  registerApp(options): Promise<LarkRegisterAppResult> {
    return sdkRegisterApp(options);
  },

  log: (msg) => {
    // Real deployment default: no other logging sink is wired through the
    // deps seam yet, so this is the one place in the file allowed to touch
    // console — everything above calls `deps.log?.(...)` instead.
    // eslint-disable-next-line no-console
    console.error(msg);
  },
};
