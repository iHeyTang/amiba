import { createHash } from "node:crypto";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type {
  StoredConversationBinding,
  StoredOutboundEnvelope,
} from "./store.js";

export interface DesktopSyncPolicy {
  enabled: boolean;
  since: number;
  /** Existing events at enable time never become a backfill. */
  floors: Record<string, number>;
}
export interface DesktopSyncDelivery extends StoredOutboundEnvelope {
  sync: {
    scope: string;
    sourceMessageId: string;
    author: "user" | "assistant";
    turn?: number;
    source: "desktop";
    policySince?: number;
  };
}
export const syncScope = (binding: StoredConversationBinding) =>
  JSON.stringify([
    binding.channelId,
    binding.conversationKey,
    binding.kind,
    binding.access ?? "owner",
  ]);

/** Strip attachment envelopes (including local paths/content) before external display. */
export function syncText(content: unknown): string {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((p) => p?.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
            .join("\n")
        : "";
  return text
    .replace(
      /<file-attachment\b[^>]*>([\s\S]*?)<\/file-attachment>/g,
      (_whole, body: string) => {
        const raw = /^Name: (".*")$/m.exec(body)?.[1];
        let name = "";
        try {
          if (raw) name = String(JSON.parse(raw)).replace(/[\r\n]/g, " ");
        } catch {
          /* Opaque envelope. */
        }
        return `[附件${name ? `：${name}` : ""}，请在桌面端查看]`;
      },
    )
    .trim();
}

/** Pure projection; never submits messages or changes the agent's roles. */
export function projectDesktopSync(
  sessionId: string,
  events: readonly SessionEvent[],
  binding: StoredConversationBinding,
  policy: DesktopSyncPolicy,
): DesktopSyncDelivery[] {
  if (!policy.enabled) return [];
  const scope = syncScope(binding);
  const result: DesktopSyncDelivery[] = [];
  let turn: number | undefined;
  let desktop = false;
  let replies: string[] = [];
  const make = (
    event: SessionEvent,
    author: "user" | "assistant",
    sourceId: string,
    text: string,
  ): DesktopSyncDelivery => ({
    id: `sync-${createHash("sha256")
      .update(JSON.stringify([scope, sessionId, author, sourceId]))
      .digest("hex")}`,
    channelId: binding.channelId,
    sessionId,
    inReplyTo: "",
    createdAt: new Date(event.time).toISOString(),
    text: `${author === "user" ? "用户" : "助手"} · 来自桌面端\n\n${text}`,
    sync: {
      scope,
      sourceMessageId: sourceId,
      author,
      source: "desktop",
      policySince: policy.since,
      ...(turn !== undefined ? { turn } : {}),
    },
  });
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const data = event.data as {
      turn?: number;
      source?: { kind?: string };
      id?: string;
      content?: unknown;
      message?: { content?: unknown };
    };
    if (event.type === "turn/start") {
      turn = typeof data.turn === "number" ? data.turn : undefined;
      desktop = false;
      replies = [];
    }
    if (
      event.type === "user/message" &&
      data.source?.kind === "user" &&
      event.seq > (policy.floors[sessionId] ?? -1) &&
      event.time >= policy.since
    ) {
      desktop = true;
      const text = syncText(data.content);
      if (text)
        result.push(make(event, "user", String(data.id ?? event.seq), text));
    }
    if (event.type === "assistant/message" && data.turn === turn) {
      const text = syncText(data.message?.content);
      if (text) replies.push(text);
    }
    if (event.type === "turn/end" && data.turn === turn) {
      if (desktop)
        result.push(
          make(
            event,
            "assistant",
            `turn:${turn}`,
            replies.join("\n\n") ||
              "本轮已结束，未生成文字回复，请在桌面端查看执行结果。",
          ),
        );
      desktop = false;
      replies = [];
      turn = undefined;
    }
  }
  return result;
}

/** A message belongs to the preceding durable turn/start, including followups. */
export function inputTurn(
  events: readonly SessionEvent[],
  messageId: string,
): number | undefined {
  let turn: number | undefined;
  for (const event of events) {
    if (event.type === "turn/start")
      turn = (event.data as { turn: number }).turn;
    if (
      event.type === "user/message" &&
      (event.data as { id?: string }).id === messageId
    )
      return turn;
  }
  return undefined;
}
