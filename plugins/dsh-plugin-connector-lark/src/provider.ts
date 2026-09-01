import { Client, Domain, EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";
import type {
  CapabilityDecl,
  ConnectorHandle,
  ConnectorInboundEnvelope,
  ConnectorProvider,
  ConnectorRuntime,
  ConnectorStatus,
} from "@amiba/dsh-plugin-connector-core";

import {
  larkConfigSchema,
  translateReceiveEvent,
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
}

/** Thin seam over `WSClient` — only what the provider core needs. */
export interface WsLike {
  start(): Promise<void>;
  close(params?: { force?: boolean }): void;
}

/** Thin seam over the HTTP `Client`, hiding every SDK call shape behind three verbs. */
export interface ApiLike {
  /** Exchanges a tenant access token; rejects with the SDK's error message on auth failure. */
  tenantToken(): Promise<void>;
  botOpenId(): Promise<string>;
  sendText(chatId: string, text: string): Promise<void>;
}

export interface LarkDeps {
  createWsClient(config: LarkConnectorConfig, callbacks: LarkWsCallbacks): WsLike;
  createApiClient(config: LarkConnectorConfig): ApiLike;
  /**
   * Console-free logging seam: the provider core never calls `console.*`
   * directly. A swallowed `handle.onInbound` error is still observable
   * through this instead of hard-crashing the ws loop. Optional so fakes in
   * tests can omit it (the swallow just becomes silent).
   */
  log?: (msg: string) => void;
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
 * Tools are out of scope for M2a — `capabilities()` is empty until M2b.
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

      const ws = deps.createWsClient(config, {
        onReady: () => safeSetStatus({ state: "ready" }),
        onReconnected: () => safeSetStatus({ state: "ready" }),
        onReconnecting: () => safeSetStatus({ state: "connecting" }),
        onError: (err) => safeSetStatus({ state: "error", detail: String(err) }),
        onEvent: async (event) => {
          if (stopped) return;
          const envelope = toEnvelope(event, botOpenId);
          if (!envelope) return;
          try {
            await handle.onInbound(envelope);
          } catch (error) {
            // Handler errors must never crash the ws loop — swallow and log.
            deps.log?.(
              `amiba-connector-lark: handle.onInbound failed: ${String(error)}`,
            );
          }
        },
      });

      await ws.start();

      const runtime: ConnectorRuntime = {
        async stop(): Promise<void> {
          if (stopped) return;
          stopped = true;
          ws.close({ force: false });
        },
        async deliver(conversation, envelope): Promise<void> {
          // No swallow here: an SDK rejection must propagate so the
          // messaging outbox retries the delivery.
          await api.sendText(conversation.key, envelope.text);
        },
      };
      return runtime;
    },

    capabilities: (): CapabilityDecl[] => [],
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
//   - domain: config's "feishu"/"lark" strings must be mapped to the Domain enum
//     (Domain.Feishu = 0 / Domain.Lark = 1). Passing the raw string through would NOT work:
//     the SDK's `formatDomain` only special-cases the two enum values and otherwise uses the
//     given string verbatim as the base URL, so an unmapped "feishu"/"lark" string would be
//     used as a broken host.
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

export const realLarkDeps: LarkDeps = {
  createWsClient(config, callbacks): WsLike {
    const dispatcher = new EventDispatcher({}).register({
      "im.message.receive_v1": (data) =>
        callbacks.onEvent?.(data as LarkReceiveEvent),
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
        await client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            msg_type: "text",
            content: JSON.stringify({ text }),
          },
        });
      },
    };
  },

  log: (msg) => {
    // Real deployment default: no other logging sink is wired through the
    // deps seam yet, so this is the one place in the file allowed to touch
    // console — everything above calls `deps.log?.(...)` instead.
    // eslint-disable-next-line no-console
    console.error(msg);
  },
};
