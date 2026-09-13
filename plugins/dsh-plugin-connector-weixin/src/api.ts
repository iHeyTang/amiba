import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

export const API_BASE = "https://ilinkai.weixin.qq.com";
export const CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
/** Keep credentials on Weixin-owned HTTPS origins, including QR redirects. */
export function weixinUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname === "weixin.qq.com" ||
      url.hostname.endsWith(".weixin.qq.com")
    )
  )
    throw new Error("weixin_untrusted_url");
  return url.toString().replace(/\/$/, "");
}
export const configSchema = z
  .object({
    botToken: z.string().min(1),
    botId: z.string().min(1),
    userId: z.string().min(1),
    baseUrl: z.string().default(API_BASE).transform(weixinUrl),
  })
  .strict();
export type WeixinConfig = z.infer<typeof configSchema>;
export interface MediaRef {
  encrypt_query_param?: string;
  aes_key?: string;
  full_url?: string;
}
export interface Item {
  type?: number;
  text_item?: { text?: string };
  image_item?: { media?: MediaRef; aeskey?: string };
  voice_item?: { media?: MediaRef; text?: string; encode_type?: number };
  file_item?: { media?: MediaRef; file_name?: string; len?: string };
  video_item?: { media?: MediaRef };
  ref_msg?: {
    message_item?: Item;
    title?: string;
    message_id?: string | number;
    svr_id?: string;
  };
  msg_id?: string;
}
export interface Message {
  message_id?: number | string;
  client_id?: string;
  from_user_id?: string;
  message_type?: number;
  group_id?: string;
  context_token?: string;
  item_list?: Item[];
}
export interface Updates {
  msgs?: Message[];
  get_updates_buf?: string;
}
export class WeixinError extends Error {
  constructor(readonly code: number) {
    super(`weixin_api_${code}`);
  }
}
export class WeixinApi {
  constructor(readonly fetcher: typeof fetch = fetch) {}
  async request<T>(
    base: string,
    endpoint: string,
    body: unknown,
    signal: AbortSignal,
    token?: string,
    timeout = 15_000,
  ): Promise<T> {
    const url = `${weixinUrl(base)}/ilink/bot/${endpoint}`;
    const response = await this.fetcher(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "iLink-App-Id": "bot",
        "iLink-App-ClientVersion": String(0x020408),
        ...(body !== undefined
          ? {
              AuthorizationType: "ilink_bot_token",
              "X-WECHAT-UIN": Buffer.from(
                String(randomBytes(4).readUInt32BE()),
              ).toString("base64"),
            }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(
              token
                ? {
                    ...(body as object),
                    base_info: {
                      channel_version: "2.4.8",
                      bot_agent: "Amiba/0.1.0",
                    },
                  }
                : body,
            ),
          }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    });
    if (!response.ok) throw new Error(`weixin_http_${response.status}`);
    // Preserve uint64 message IDs: JSON.parse otherwise rounds them before dedup/quote lookup.
    const source = await response.text();
    const lossless = source.replace(
      /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (value) => (/^-?\d{16,}$/.test(value) ? JSON.stringify(value) : value),
    );
    const result = JSON.parse(lossless) as { ret?: number; errcode?: number };
    if (!result || typeof result !== "object")
      throw new Error("weixin_invalid_response");
    if (result.ret || result.errcode)
      throw new WeixinError(result.errcode || result.ret!);
    return result as T;
  }
  call<T>(
    config: WeixinConfig,
    endpoint: string,
    body: unknown,
    signal: AbortSignal,
    timeout?: number,
  ) {
    return this.request<T>(
      config.baseUrl,
      endpoint,
      body,
      signal,
      config.botToken,
      timeout,
    );
  }
  updates(config: WeixinConfig, cursor: string, signal: AbortSignal) {
    return this.call<Updates>(
      config,
      "getupdates",
      { get_updates_buf: cursor },
      signal,
      40_000,
    );
  }
  async send(
    config: WeixinConfig,
    to: string,
    context: string,
    item: unknown,
    id: string,
    signal: AbortSignal,
  ) {
    if (!context)
      throw new Error("weixin_conversation_expired_send_a_message_first");
    if (to !== config.userId) throw new Error("weixin_recipient_not_owner");
    return this.call<{ message_id?: string }>(
      config,
      "sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: to,
          client_id: id,
          message_type: 2,
          message_state: 2,
          context_token: context,
          item_list: [item],
        },
      },
      signal,
    );
  }
  async typing(
    config: WeixinConfig,
    context: string,
    active: boolean,
    signal: AbortSignal,
  ) {
    const value = await this.call<{ typing_ticket?: string }>(
      config,
      "getconfig",
      { ilink_user_id: config.userId, context_token: context },
      signal,
    );
    if (value.typing_ticket)
      await this.call(
        config,
        "sendtyping",
        {
          ilink_user_id: config.userId,
          typing_ticket: value.typing_ticket,
          status: active ? 1 : 2,
        },
        signal,
      );
  }
}
export const pause = (ms: number, signal: AbortSignal) =>
  delay(ms, undefined, { signal });
