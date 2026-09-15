import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-tools";
import type { AmibaNotificationHub } from "@amiba/dsh-plugin-notification-hub";
export const name = "amiba-conversation-notifications";
export const inject = ["amibaNotifications"];
type Event = { type: string; data: unknown; seq?: number; timestamp?: number };
type Session = {
  id: string;
  header: { title?: string; parentSession?: string };
  snapshotEvents(): readonly Event[];
};
const source = "conversation";
export function conversationNotificationListener(hub: AmibaNotificationHub) {
  const running = new Map<string, { base: "thinking" | "responding"; tools: Set<string>; approvals: Set<string>; questions: Set<string> }>();
  return (session: Session, event: Event) => {
    const data = (event.data ?? {}) as Record<string, unknown>;
    let title = session.header.title ?? "";
    for (const item of session.snapshotEvents()) {
      if (item.type === "session/title")
        title = String((item.data as { title?: string }).title ?? title);
    }
    const headline = title.trim().slice(0, 160) || "Untitled conversation";
    if (event.type === "session/title") {
      hub.renameSession(session.id, headline);
      return;
    }
    if (event.type === "turn/start") {
      running.set(session.id, { base: "thinking", tools: new Set(), approvals: new Set(), questions: new Set() });
      hub.setSessionActivity(session.id, headline, "thinking");
      return;
    }
    const live = running.get(session.id);
    if (live) {
      if (event.type === "assistant/chunk") {
        const chunk = data.chunk as { type?: string } | undefined;
        if (chunk?.type === "text-delta") live.base = "responding";
        if (chunk?.type === "reasoning-delta") live.base = "thinking";
      }
      if (event.type === "approval/asked") live.approvals.add(String(data.id));
      if (event.type === "approval/decided") live.approvals.delete(String(data.id));
      if (event.type === "tool/call" && typeof data.callId === "string") {
        live.tools.add(data.callId);
        if (data.name === "ask_user_question") live.questions.add(data.callId);
      }
      if (event.type === "tool/result") {
        const message = data.message as { toolCallId?: string; source?: { callId?: string }; content?: { type?: string; toolCallId?: string }[] } | undefined;
        const id = String(message?.toolCallId ?? message?.source?.callId ?? message?.content?.find(b => b.type === "tool-result")?.toolCallId ?? data.callId ?? "");
        live.tools.delete(id);
        live.questions.delete(id);
      }
      hub.setSessionActivity(session.id, headline, live.approvals.size || live.questions.size ? "waiting" : live.tools.size ? "tooling" : live.base);
    }
    const key = `${session.id}:approval:${data.id}`;
    if (event.type === "approval/decided") {
      hub.resolve(source, key);
      return;
    }
    if (event.type === "approval/asked") {
      hub.post({
        title: headline,
        source,
        sessionId: session.id,
        key,
        kind: "warning",
        status: "waiting",
      });
      return;
    }
    if (event.type !== "turn/end") return;
    running.delete(session.id);
    hub.setSessionActivity(session.id, headline, null);
    const reason =
      typeof data.reason === "string"
        ? { kind: data.reason }
        : ((data.reason ?? {}) as { kind?: string });
    const status =
      reason.kind === "completed"
        ? "completed"
        : reason.kind === "error"
          ? "failed"
          : "interrupted";
    hub.post({
      title: headline,
      source,
      sessionId: session.id,
      key: `${session.id}:turn:${data.turn ?? event.seq ?? session.snapshotEvents().length}`,
      kind:
        status === "failed"
          ? "error"
          : status === "completed"
            ? "success"
            : "info",
      status,
    });
  };
}
export function apply(ctx: Context) {
  ctx.on(
    "session/event",
    conversationNotificationListener(ctx.amibaNotifications),
  );
  // User questions have no session audit event in DSH. Observe the actual
  // tool lifetime without replacing its answer provider or its result.
  ctx.on("tools/execute", async (exec, next) => {
    if (exec.name !== "ask_user_question" || !exec.agent) return next();
    const session = exec.agent.session;
    const titleEvent = [...(session.snapshotEvents() as readonly Event[])]
      .reverse()
      .find((e) => e.type === "session/title");
    const title = titleEvent
      ? String((titleEvent.data as { title: string }).title)
      : "Untitled conversation";
    let id: string | undefined;
    try {
      id = ctx.amibaNotifications.post({
        title: title.slice(0, 160),
        source,
        sessionId: session.id,
        kind: "warning",
        status: "waiting",
      }).id;
    } catch (error) {
      ctx.logger.warn(`Could not post question notice: ${String(error)}`);
    }
    try {
      return await next();
    } finally {
      try {
        if (id) ctx.amibaNotifications.resolveNotification(id);
      } catch (error) {
        ctx.logger.warn(`Could not settle question notice: ${String(error)}`);
      }
    }
  });
}
