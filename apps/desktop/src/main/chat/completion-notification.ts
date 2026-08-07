/** Pure helpers for the background-chat completion notifier. */

export interface ChatCompletedNotifierMessage {
  type: "chat-completed";
  id: string;
  sessionId: string;
  title?: string;
  summary?: string;
  timestamp: number;
}

export interface ApprovalPendingNotifierMessage {
  type: "approval-pending";
  approvalId: string;
  sessionId: string;
  title?: string;
  tool?: string;
  command?: string;
  message: string;
  timestamp: number;
}

interface HistoryMessage {
  role: string;
  content: string;
}

interface AttentionWindow {
  isDestroyed(): boolean;
  isFocusable(): boolean;
  isFocused(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
}

/** Notify unless a real, visible Amiba surface already has the user's focus. */
export function shouldNotifyForWindowState(
  windows: readonly AttentionWindow[],
  notifierWindow: AttentionWindow | null,
): boolean {
  return !windows.some((window) => {
    if (window === notifierWindow) return false;
    if (window.isDestroyed() || !window.isFocusable()) return false;
    return window.isFocused() && window.isVisible() && !window.isMinimized();
  });
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function latestUserPrompt(history: readonly HistoryMessage[]): string {
  const message = [...history].reverse().find((item) => item.role === "user");
  if (!message) return "";

  let content = message.content;
  // Composer file metadata precedes the user's actual prompt. Keep the part
  // after the final attachment block so the notification title remains the
  // question they typed instead of an implementation-facing file preamble.
  const attachmentEnd = content.lastIndexOf("</file-attachment>");
  if (attachmentEnd >= 0) {
    content = content.slice(attachmentEnd + "</file-attachment>".length);
  }
  content = content.replace(/<workspace>[\s\S]*?<\/workspace>/gi, " ");
  return compact(content, 88);
}

function notificationTitle(
  sessionTitle: string | undefined,
  history: readonly HistoryMessage[],
): string {
  const title = compact(sessionTitle ?? "", 88);
  return title || latestUserPrompt(history);
}

export function buildApprovalPendingNotification(args: {
  approvalId: string;
  sessionId: string;
  sessionTitle?: string;
  history: readonly HistoryMessage[];
  tool?: string;
  command?: string;
  message: string;
  timestamp?: number;
}): ApprovalPendingNotifierMessage {
  const title = notificationTitle(args.sessionTitle, args.history);
  return {
    type: "approval-pending",
    approvalId: args.approvalId,
    sessionId: args.sessionId,
    ...(title ? { title } : {}),
    ...(args.tool ? { tool: args.tool } : {}),
    ...(args.command ? { command: args.command } : {}),
    message: args.message,
    timestamp: args.timestamp ?? Date.now(),
  };
}

export function buildChatCompletedNotification(args: {
  sessionId: string;
  assistantUiId: string;
  history: readonly HistoryMessage[];
  assistantText: string;
  timestamp?: number;
}): ChatCompletedNotifierMessage {
  const title = latestUserPrompt(args.history);
  const summary = compact(args.assistantText, 220);
  return {
    type: "chat-completed",
    id: `chat_${args.sessionId}_${args.assistantUiId}`,
    sessionId: args.sessionId,
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    timestamp: args.timestamp ?? Date.now(),
  };
}
