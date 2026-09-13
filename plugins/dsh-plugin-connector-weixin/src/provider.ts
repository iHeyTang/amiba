import { createHash } from "node:crypto";
import path from "node:path";
import type {
  ConnectorProvider,
  ConnectorRuntime,
  ConnectorHandle,
} from "@amiba/dsh-plugin-connector-core";
import {
  configSchema,
  type Item,
  type Message,
  WeixinApi,
  WeixinError,
  pause,
} from "./api.js";
import { downloadMedia, uploadMedia } from "./media.js";
import { onboard } from "./onboard.js";
import { StateStore } from "./state.js";

export interface WeixinRuntime extends ConnectorRuntime {
  sendFile(file: string, requestId: string, signal: AbortSignal): Promise<void>;
  mediaRoot: string;
  progress(item: unknown, id: string): Promise<void>;
}
export interface ProviderOptions {
  root: string;
  api?: WeixinApi;
  runtimes?: Map<string, WeixinRuntime>;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function createWeixinProvider(
  options: ProviderOptions,
): ConnectorProvider {
  const api = options.api ?? new WeixinApi();
  return {
    id: "weixin",
    name: "微信 / Weixin",
    description: "通过微信 ClawBot 与个人助手对话、发送图片和文件。",
    messaging: { ownerPairing: true, sharedConversations: false },
    configSchema,
    capabilities: () => [],
    settings: () => ({ conversation: "personal", mediaLimitMB: 50 }),
    configure: (config, patch) => {
      if (Object.keys(patch).length)
        throw new Error("weixin_settings_readonly");
      return configSchema.parse(config);
    },
    async validate(value) {
      configSchema.parse(value);
    },
    onboard: (handle) => onboard(api, handle),
    async start(handle: ConnectorHandle) {
      const config = configSchema.parse(handle.config);
      const store = new StateStore(
        options.root,
        `${handle.connectId}:${config.botId}:${config.userId}`,
      );
      const mediaRoot = path.join(store.directory, "media");
      const abort = new AbortController();
      const signal = abort.signal;
      let stopped = false;
      const status = (value: Parameters<ConnectorHandle["setStatus"]>[0]) => {
        if (!stopped) handle.setStatus(value);
      };
      status({ state: "connecting" });
      const sendItem = async (
        item: unknown,
        id: string,
        outerSignal = signal,
      ) => {
        signal.throwIfAborted();
        const state = await store.read();
        if (state.sent.includes(id)) return;
        const response = await api.send(
          config,
          config.userId,
          state.context,
          item,
          id,
          AbortSignal.any([signal, outerSignal]),
        );
        await store.mutate((next) => {
          next.sent.push(id);
          if (response.message_id)
            next.quotes[String(response.message_id)] = {
              text: (item as Item).text_item?.text || "[已发送附件]",
              at: Date.now(),
            };
        });
      };
      async function describeItem(
        item: Item,
        id: string,
        depth = 0,
      ): Promise<string> {
        if (depth > 2) return "";
        const parts: string[] = [];
        if (item.text_item?.text) parts.push(item.text_item.text);
        if (item.voice_item?.text) parts.push(item.voice_item.text);
        if ([2, 3, 4, 5].includes(item.type ?? 0)) {
          try {
            const file = await downloadMedia(api, item, mediaRoot, id, signal);
            if (file)
              parts.push(
                `[微信附件 ${JSON.stringify({ path: file, type: item.type })}]`,
              );
            else if (!item.voice_item?.text)
              parts.push("[微信附件缺少下载信息，请重新发送]");
          } catch (error) {
            signal.throwIfAborted();
            parts.push("[微信附件下载失败，请重新发送或改发文字]");
          }
        }
        if (item.ref_msg) {
          const ref = item.ref_msg;
          const referenceId = ref.svr_id || ref.message_item?.msg_id;
          const quoted = ref.message_item
            ? await describeItem(ref.message_item, `${id}:quote`, depth + 1)
            : referenceId
              ? (await store.read()).quotes[referenceId]?.text
              : undefined;
          parts.push(`[引用消息：${quoted || "缓存中没有原内容，请重新发送"}]`);
        }
        return parts.join("\n");
      }
      async function receive(message: Message) {
        if (
          message.message_type !== 1 ||
          message.group_id ||
          message.from_user_id !== config.userId
        )
          return;
        const id = String(message.message_id || message.client_id || "");
        if (!id || !Array.isArray(message.item_list)) return;
        if (message.context_token)
          await store.mutate((state) => {
            state.context = message.context_token!;
          });
        if ((await store.read()).seen.includes(id)) return;
        const text: string[] = [];
        for (const [index, item] of message.item_list.entries())
          text.push(await describeItem(item, `${id}:${index}`));
        const body =
          text.filter(Boolean).join("\n") ||
          "[微信消息类型暂不支持，请改发文字、图片或文件]";
        signal.throwIfAborted();
        const result = await handle.onInbound({
          id,
          text: body,
          sender: config.userId,
          conversation: {
            key: config.userId,
            kind: "p2p",
            title: "微信 ClawBot",
          },
        });
        if (!result) throw new Error("weixin_inbound_not_accepted");
        await store.mutate((state) => {
          state.seen.push(id);
          state.quotes[id] = { text: body, at: Date.now() };
        });
        void api
          .typing(config, (await store.read()).context, true, signal)
          .catch(() => {});
      }
      async function monitor() {
        let failures = 0;
        while (!signal.aborted) {
          try {
            const response = await api.updates(
              config,
              (await store.read()).cursor,
              signal,
            );
            signal.throwIfAborted();
            if (response.msgs !== undefined && !Array.isArray(response.msgs))
              throw new Error("weixin_invalid_messages");
            for (const message of response.msgs ?? []) await receive(message);
            if (response.get_updates_buf)
              await store.mutate((state) => {
                state.cursor = response.get_updates_buf!;
              });
            failures = 0;
            status({ state: "ready" });
            if (!response.msgs?.length) await pause(300, signal);
          } catch (error) {
            if (signal.aborted) return;
            if (error instanceof WeixinError && error.code === -14) {
              await store.mutate((state) => {
                state.context = "";
              });
              status({
                state: "error",
                detail: "微信授权已失效，请重新扫码连接。",
              });
              return;
            }
            status({
              state: "degraded",
              detail: "微信连接暂时中断，正在重试。",
            });
            await pause(
              Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)),
              signal,
            ).catch(() => {});
          }
        }
      }
      const runtime: WeixinRuntime = {
        mediaRoot,
        progress: (item, id) => sendItem(item, `amiba-progress-${hash(id)}`),
        async stop() {
          stopped = true;
          abort.abort();
          if (options.runtimes?.get(handle.connectId) === runtime)
            options.runtimes.delete(handle.connectId);
          await running;
        },
        async deliver(conversation, envelope) {
          if (conversation.kind !== "p2p" || conversation.key !== config.userId)
            throw new Error("weixin_recipient_not_owner");
          // Stable per-chunk IDs plus durable receipts avoid resending earlier chunks on retry.
          const chars = Array.from(envelope.text);
          for (let offset = 0; offset < chars.length; offset += 2000) {
            await sendItem(
              {
                type: 1,
                text_item: {
                  text: chars.slice(offset, offset + 2000).join(""),
                },
              },
              `amiba-${hash(`${envelope.id}:${offset}`)}`,
            );
          }
          void api
            .typing(config, (await store.read()).context, false, signal)
            .catch(() => {});
        },
        async sendFile(file, requestId, outerSignal) {
          signal.throwIfAborted();
          if (!(await store.read()).context)
            throw new Error("weixin_conversation_expired_send_a_message_first");
          const id = `amiba-${hash(requestId)}`;
          if ((await store.read()).sent.includes(id)) return;
          const item = await uploadMedia(
            api,
            config,
            file,
            AbortSignal.any([signal, outerSignal]),
          );
          await sendItem(item, id, outerSignal);
        },
      };
      options.runtimes?.set(handle.connectId, runtime);
      const running = monitor().catch(() => {
        status({ state: "error", detail: "微信连接无法继续，请重新连接。" });
      });
      return runtime;
    },
  };
}
