import { DWClient, GET_TOKEN_URL, TOPIC_ROBOT } from "dingtalk-stream";
import type { DWClientDownStream } from "dingtalk-stream";
import type {
  CapabilityDecl,
  ConnectorHandle,
  ConnectorProvider,
  ConnectorRuntime,
  ConnectorStatus,
} from "@amiba/dsh-plugin-connector-core";

import {
  dingtalkConfigSchema,
  translateRobotMessage,
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

export interface DingtalkDeps {
  createClient(config: DingtalkConnectorConfig, handlers: DingtalkClientHandlers): DwLike;
  /** Exchanges an access token via `GET_TOKEN_URL`; rejects on auth failure. Used only for validation. */
  token(config: DingtalkConnectorConfig): Promise<void>;
  /** Posts a reply body to a conversation's session webhook URL; rejects propagate to the outbox. */
  postWebhook(url: string, body: unknown): Promise<void>;
  /**
   * Console-free logging seam: the provider core never calls `console.*`
   * directly. A swallowed `handle.onInbound` error is still observable
   * through this instead of hard-crashing the stream loop. Optional so
   * fakes in tests can omit it (the swallow just becomes silent).
   */
  log?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// capabilities() — the official DingTalk MCP server, opt-in via config's
// `enableTools` (default false: the upstream is official-but-experimental,
// so the conversation loop must stay independent of it). Verified at
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
//     are all valid ids (read-oriented: contacts lookup, calendar, todos —
//     no message-sending or app-management profile is enabled by default).
// ---------------------------------------------------------------------------

const DINGTALK_MCP_PACKAGE = "dingtalk-mcp";
const DINGTALK_MCP_PINNED_VERSION = "1.1.21";
const DINGTALK_MCP_ACTIVE_PROFILES = "dingtalk-contacts,dingtalk-calendar,dingtalk-tasks";

function buildCapabilities(config: DingtalkConnectorConfig): CapabilityDecl[] {
  if (!config.enableTools) return [];
  return [
    {
      kind: "mcp",
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

/**
 * DingTalk `ConnectorProvider`: runs the official Stream Mode long
 * connection (no public IP required), translates inbound robot messages
 * into `ConnectorInboundEnvelope`s, and delivers outbound text via each
 * message's own session webhook. `capabilities()` declares the official
 * `dingtalk-mcp` tool server, strictly opt-in via config `enableTools`.
 */
export function createDingtalkProvider(
  deps: DingtalkDeps = realDingtalkDeps,
): ConnectorProvider {
  return {
    id: "dingtalk",
    name: "钉钉 / DingTalk",
    description: "DingTalk robot over the official Stream Mode long connection.",
    configSchema: dingtalkConfigSchema,

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

  log: (msg) => {
    // Real deployment default: no other logging sink is wired through the
    // deps seam yet, so this is the one place in the file allowed to touch
    // console — everything above calls `deps.log?.(...)` instead.
    // eslint-disable-next-line no-console
    console.error(msg);
  },
};
