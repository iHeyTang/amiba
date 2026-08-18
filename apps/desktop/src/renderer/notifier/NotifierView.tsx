import { APPROVAL_DEFAULT_TIMEOUT_MS } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import {
  ApprovalCode,
  ApprovalCountdownBar,
  presentApprovalDescription,
  useResolvedTheme,
} from "@amiba/ui";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Mirrors `NotifierMessage` in `main/notifier-window.ts`. Kept local so
 * the renderer entry doesn't pull in main-process types.
 */
type NotifierMessage =
  | {
      type: "chat-completed";
      id: string;
      sessionId: string;
      title?: string;
      summary?: string;
      timestamp: number;
    }
  | {
      type: "cron-completed";
      id: string;
      title?: string;
      summary: string;
      timestamp: number;
    }
  | {
      type: "approval-pending";
      approvalId: string;
      sessionId: string;
      title?: string;
      tool?: string;
      command?: string;
      message: string;
      timestamp: number;
    }
  | { type: "dismiss"; id: string };

type NotifierCard =
  | {
      kind: "chat-completed";
      id: string;
      sessionId: string;
      title?: string;
      summary?: string;
    }
  | {
      kind: "cron-completed";
      id: string;
      title?: string;
      summary: string;
    }
  | {
      kind: "approval-pending";
      approvalId: string;
      sessionId: string;
      title?: string;
      tool?: string;
      command?: string;
      message: string;
      timestamp: number;
    };

type NotifierTone = "complete" | "approval";

function cardKey(card: NotifierCard): string {
  return card.kind === "approval-pending" ? card.approvalId : card.id;
}

export function NotifierView() {
  useResolvedTheme();
  const [card, setCard] = useState<NotifierCard | null>(null);
  const cardRef = useRef<NotifierCard | null>(null);

  useEffect(() => {
    const bridge = window.amiba.notifier;
    const off = bridge.onMessage((msg: unknown) => {
      const m = msg as NotifierMessage;
      if (m.type === "chat-completed") {
        const nextCard: NotifierCard = {
          kind: "chat-completed",
          id: m.id,
          sessionId: m.sessionId,
          title: m.title,
          summary: m.summary,
        };
        cardRef.current = nextCard;
        setCard(nextCard);
      } else if (m.type === "cron-completed") {
        const nextCard: NotifierCard = {
          kind: "cron-completed",
          id: m.id,
          title: m.title,
          summary: m.summary,
        };
        cardRef.current = nextCard;
        setCard(nextCard);
      } else if (m.type === "approval-pending") {
        const nextCard: NotifierCard = {
          kind: "approval-pending",
          approvalId: m.approvalId,
          sessionId: m.sessionId,
          title: m.title,
          tool: m.tool,
          command: m.command,
          message: m.message,
          timestamp: m.timestamp,
        };
        cardRef.current = nextCard;
        setCard(nextCard);
      } else if (m.type === "dismiss") {
        const activeCard = cardRef.current;
        if (activeCard && cardKey(activeCard) === m.id) {
          cardRef.current = null;
          setCard(null);
          void bridge.hide();
        }
      }
    });
    return () => off();
  }, []);

  if (!card) {
    return <div className="h-screen w-screen bg-transparent" />;
  }

  const dismiss = () => {
    cardRef.current = null;
    setCard(null);
    void window.amiba.notifier.hide();
  };

  if (card.kind === "cron-completed" || card.kind === "chat-completed") {
    return (
      <CompletedCard
        kind={card.kind === "chat-completed" ? "chat" : "cron"}
        title={card.title}
        onOpen={() => {
          cardRef.current = null;
          const sessionId =
            card.kind === "chat-completed" ? card.sessionId : card.id;
          void window.amiba.notifier.openSession(sessionId);
          setCard(null);
        }}
        onDismiss={dismiss}
      />
    );
  }

  return (
    <ApprovalPendingCard
      title={card.title}
      tool={card.tool}
      command={card.command}
      message={card.message}
      requestedAt={card.timestamp}
      onOpen={() => {
        cardRef.current = null;
        void window.amiba.notifier.openSession(card.sessionId);
        setCard(null);
      }}
      onAllow={() => {
        cardRef.current = null;
        void window.amiba.notifier.approve(card.approvalId);
        setCard(null);
      }}
      onDeny={() => {
        cardRef.current = null;
        void window.amiba.notifier.deny(card.approvalId);
        setCard(null);
      }}
      onDismiss={dismiss}
    />
  );
}

function CardShell({
  children,
  tone,
  label,
}: {
  children: React.ReactNode;
  tone: NotifierTone;
  label: string;
}) {
  const surfaceClass =
    tone === "approval"
      ? "border-border/55 bg-popover"
      : "border-border/70 bg-popover";

  return (
    <div
      aria-label={label}
      className="flex h-screen w-screen items-stretch p-7"
      role={tone === "approval" ? "alert" : "status"}
    >
      <div
        className={`animate-notifier-card-in relative flex w-full overflow-hidden rounded-xl border text-popover-foreground shadow-overlay ${surfaceClass}`}
      >
        <div
          aria-hidden="true"
          className="app-drag-region absolute inset-x-0 top-0 h-2"
        />
        <div className="flex min-w-0 flex-1 px-3 py-2">{children}</div>
      </div>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  const { t } = useT();

  return (
    <button
      aria-label={t("notifier.dismiss")}
      className="app-no-drag inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/55 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      type="button"
    >
      <X className="h-3 w-3" strokeWidth={1.75} />
    </button>
  );
}

function NotificationLayout({
  title,
  status,
  actions,
  onDismiss,
  actionsClassName = "flex items-center justify-end",
}: {
  title: string;
  status: React.ReactNode;
  actions: React.ReactNode;
  onDismiss: () => void;
  actionsClassName?: string;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-5 min-w-0 items-center gap-2">
        <span className="block max-w-[52%] shrink-0 truncate text-[13px] font-medium leading-5 text-foreground">
          {title}
        </span>
        <div className="flex min-w-0 flex-1 items-center overflow-hidden text-[11px] leading-4 text-muted-foreground">
          {status}
        </div>
        <CloseButton onClick={onDismiss} />
      </div>
      <div className={`app-no-drag mt-1 h-6 shrink-0 ${actionsClassName}`}>
        {actions}
      </div>
    </div>
  );
}

function CompletedCard({
  kind,
  title,
  onOpen,
  onDismiss,
}: {
  kind: "chat" | "cron";
  title?: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t } = useT();
  const status = t(
    kind === "chat" ? "notifier.chat.status" : "notifier.cron.status",
  );
  const fallbackTitle = t(
    kind === "chat"
      ? "notifier.chat.fallbackTitle"
      : "notifier.cron.fallbackTitle",
  );
  const openLabel = t(
    kind === "chat" ? "notifier.chat.open" : "notifier.cron.open",
  );

  return (
    <CardShell label={status} tone="complete">
      <NotificationLayout
        title={title ?? fallbackTitle}
        status={<span className="truncate">{status}</span>}
        onDismiss={onDismiss}
        actions={
          <button
            className="app-no-drag inline-flex h-6 w-full items-center justify-center rounded-md bg-muted/70 px-2.5 text-[10px] font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={onOpen}
            type="button"
          >
            {openLabel}
          </button>
        }
      />
    </CardShell>
  );
}

function ApprovalPendingCard({
  title,
  tool,
  command,
  message,
  requestedAt,
  onOpen,
  onAllow,
  onDeny,
  onDismiss,
}: {
  title?: string;
  tool?: string;
  command?: string;
  message: string;
  requestedAt: number;
  onOpen: () => void;
  onAllow: () => void;
  onDeny: () => void;
  onDismiss: () => void;
}) {
  const { t } = useT();
  const rawDescription = message.trim();
  const description = presentApprovalDescription(rawDescription, t);
  const approvalStatus = t("notifier.approval.status");
  const notificationTitle = title?.trim() || approvalStatus;

  return (
    <CardShell label={approvalStatus} tone="approval">
      <NotificationLayout
        title={notificationTitle}
        onDismiss={onDismiss}
        status={
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <ApprovalCountdownBar
              requestedAt={requestedAt}
              timeoutMs={APPROVAL_DEFAULT_TIMEOUT_MS}
            />
            {tool && (
              <span className="shrink-0 truncate font-mono text-[10px] leading-4 text-muted-foreground/75">
                {tool}
              </span>
            )}
            {tool && (command || description) ? (
              <span aria-hidden="true" className="text-[10px] text-border">
                ·
              </span>
            ) : null}
            {command ? (
              <pre
                className="approval-code min-w-0 flex-1 truncate whitespace-pre font-mono text-[10px] leading-4 text-foreground/75"
                title={description || command}
              >
                <ApprovalCode command={command} tool={tool} />
              </pre>
            ) : description ? (
              <span
                className="min-w-0 flex-1 truncate text-[10px] leading-4 text-foreground/65"
                title={
                  description !== rawDescription ? rawDescription : undefined
                }
              >
                {description}
              </span>
            ) : null}
          </div>
        }
        actions={
          <>
            <button
              className="app-no-drag inline-flex h-6 items-center justify-center rounded-md bg-muted/70 px-2 text-[10px] font-medium text-foreground/75 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={onOpen}
              type="button"
            >
              {t("notifier.chat.open")}
            </button>
            <button
              className="app-no-drag inline-flex h-6 items-center justify-center rounded-md bg-primary/[0.12] px-2 text-[10px] font-medium text-primary transition-colors hover:bg-primary/[0.16] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/35"
              onClick={onAllow}
              type="button"
            >
              {t("sidepanel.permission.allowOnce")}
            </button>
            <button
              className="app-no-drag inline-flex h-6 items-center justify-center rounded-md bg-destructive/[0.07] px-2 text-[10px] font-medium text-destructive/90 transition-colors hover:bg-destructive/[0.11] hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-destructive/30"
              onClick={onDeny}
              type="button"
            >
              {t("sidepanel.permission.deny")}
            </button>
          </>
        }
        actionsClassName="grid grid-cols-[1fr_1.25fr_.75fr] items-center gap-1"
      />
    </CardShell>
  );
}
