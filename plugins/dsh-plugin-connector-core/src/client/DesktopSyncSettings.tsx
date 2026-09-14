import { useEffect, useRef, useState } from "react";
import { Button, usePluginT } from "@amiba/ui/plugin";
import type { ConnectAdapter } from "./adapter.js";
import type { MessageConversationView } from "../remote.js";

/** The same controls serve all transports, both account settings and the chat header. */
export function DesktopSyncSettings({
  adapter,
  connectId,
  conversationKey,
  target,
}: {
  adapter: ConnectAdapter;
  connectId: string;
  conversationKey: string;
  target: string;
}) {
  const { language } = usePluginT();
  const zh = language === "zh-CN";
  const [view, setView] = useState<MessageConversationView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    let loading = false;
    setView(undefined);
    setError(false);
    const refresh = async () => {
      if (loading || saving.current) return;
      loading = true;
      const requestRevision = revision.current;
      try {
        const next = await adapter.conversationSettings!(
          connectId,
          conversationKey,
          { action: "status" },
        );
        if (active && requestRevision === revision.current) {
          setView(next);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [adapter, connectId, conversationKey]);
  const change = async (
    input: Parameters<NonNullable<ConnectAdapter["conversationSettings"]>>[2],
  ) => {
    revision.current++;
    saving.current = true;
    setBusy(true);
    setError(false);
    try {
      setView(
        await adapter.conversationSettings!(connectId, conversationKey, input),
      );
    } catch {
      setError(true);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const sync = view?.desktopSync;
  const status = (row: NonNullable<typeof sync>["messages"][number]) => {
    if (row.state === "failed") {
      if (row.error === "sync_delivery_unconfirmed")
        return zh
          ? "发送结果待确认：请先查看 IM，重试可能重复发送"
          : "Delivery unconfirmed: check IM before retrying; a retry may duplicate it";
      if (
        /session_webhook_unavailable|weixin_conversation_expired|connector_not_live/.test(
          row.error ?? "",
        )
      )
        return zh
          ? "等待会话恢复：请在 IM 中发送一条消息"
          : "Waiting for conversation: send a message in IM";
      return zh
        ? "发送失败，可重试；若授权失效请重新连接"
        : "Delivery failed; retry or reconnect if authorization expired";
    }
    return {
      queued: zh ? "待同步" : "Queued",
      sent: zh ? "已发送" : "Sent",
      cancelled: zh ? "已取消" : "Cancelled",
    }[row.state];
  };
  return (
    <section className="space-y-3 text-sm">
      <label className="flex items-center justify-between gap-3">
        <span>
          {zh ? "同步到：" : "Sync to: "}
          {target}
        </span>
        <input
          type="checkbox"
          aria-label={zh ? "同步桌面端消息" : "Sync desktop messages"}
          checked={sync?.enabled ?? false}
          disabled={busy || !view}
          onChange={(event) =>
            void change({
              action: "configure",
              desktopSync: event.target.checked,
            })
          }
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {zh
          ? "由机器人发送你的消息和助手回复。开启后只同步新消息，群聊内所有成员可见。附件请在桌面端查看。"
          : "The bot posts your messages and assistant replies. Only new messages are synced; everyone in the target group can see them. View attachments on desktop."}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {zh
            ? "暂时无法更新同步状态，请稍后重试。"
            : "Unable to update sync status. Please try again."}
        </p>
      )}
      {sync?.messages.length ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {zh ? "最近同步记录" : "Recent deliveries"}
          </summary>
          <ul className="mt-2 max-h-64 space-y-3 overflow-auto">
            {sync.messages
              .slice()
              .reverse()
              .map((row) => (
                <li
                  key={row.id}
                  className="space-y-1 border-b border-border pb-2"
                >
                  <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs">
                    {row.text}
                  </p>
                  <p className="text-xs text-muted-foreground">{status(row)}</p>
                </li>
              ))}
          </ul>
        </details>
      ) : null}
      {sync?.messages.some((row) => row.state === "failed") && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void change({ action: "retry-sync" })}
        >
          {zh ? "重试同步" : "Retry sync"}
        </Button>
      )}
    </section>
  );
}

export function DesktopSyncHeader({
  sessionId,
  adapter,
}: {
  sessionId: string;
  adapter: ConnectAdapter;
}) {
  const { language } = usePluginT();
  const zh = language === "zh-CN";
  const [route, setRoute] = useState<{
    connectId: string;
    key: string;
    target: string;
    enabled: boolean;
  }>();
  useEffect(() => {
    let active = true;
    let loading = false;
    setRoute(undefined);
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        let found: typeof route;
        for (const connect of await adapter.list()) {
          const details = await adapter.details(connect.id);
          const binding = details.messaging?.conversations.find(
            (item) => item.sessionId === sessionId,
          );
          if (!binding) continue;
          const view = await adapter.conversationSettings!(
            connect.id,
            binding.key,
            { action: "status" },
          );
          found = {
            connectId: connect.id,
            key: binding.key,
            target: `${connect.name} · ${binding.title || (zh ? "当前聊天" : "Current chat")}`,
            enabled: view.desktopSync?.enabled ?? false,
          };
          break;
        }
        if (active) setRoute(found);
      } catch {
        /* Keep the last known destination through temporary disconnects. */
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [adapter, sessionId, zh]);
  if (!route) return null;
  return (
    <details className="relative text-xs">
      <summary className="max-w-64 cursor-pointer truncate text-muted-foreground">
        {route.enabled
          ? zh
            ? "同步到："
            : "Sync to: "
          : zh
            ? "同步已关闭："
            : "Sync off: "}
        {route.target}
      </summary>
      <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-md border border-border bg-background p-4">
        <DesktopSyncSettings
          key={`${route.connectId}:${route.key}`}
          adapter={adapter}
          connectId={route.connectId}
          conversationKey={route.key}
          target={route.target}
        />
      </div>
    </details>
  );
}
