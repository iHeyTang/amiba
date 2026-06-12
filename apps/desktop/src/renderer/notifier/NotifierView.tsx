import { useEffect, useState } from "react"

/**
 * Mirrors `NotifierMessage` in `main/notifier-window.ts`. Kept local so
 * the renderer entry doesn't pull in main-process types.
 */
type NotifierMessage =
  | {
      type: "cron-completed"
      id: string
      title?: string
      summary: string
      timestamp: number
    }
  | {
      type: "approval-pending"
      approvalId: string
      tool?: string
      command?: string
      message: string
      timestamp: number
    }
  | { type: "dismiss"; id: string }

type NotifierCard =
  | {
      kind: "cron-completed"
      id: string
      title?: string
      summary: string
    }
  | {
      kind: "approval-pending"
      approvalId: string
      tool?: string
      command?: string
      message: string
    }

function cardKey(card: NotifierCard): string {
  return card.kind === "cron-completed" ? card.id : card.approvalId
}

export function NotifierView() {
  const [card, setCard] = useState<NotifierCard | null>(null)

  useEffect(() => {
    const bridge = window.amiba.notifier
    const off = bridge.onMessage((msg: unknown) => {
      const m = msg as NotifierMessage
      if (m.type === "cron-completed") {
        setCard({
          kind: "cron-completed",
          id: m.id,
          title: m.title,
          summary: m.summary,
        })
      } else if (m.type === "approval-pending") {
        setCard({
          kind: "approval-pending",
          approvalId: m.approvalId,
          tool: m.tool,
          command: m.command,
          message: m.message,
        })
      } else if (m.type === "dismiss") {
        setCard((prev) => (prev && cardKey(prev) === m.id ? null : prev))
      }
    })
    return () => off()
  }, [])

  if (!card) {
    return <div className="h-screen w-screen bg-transparent" />
  }

  if (card.kind === "cron-completed") {
    return (
      <CronCompletedCard
        title={card.title}
        summary={card.summary}
        onActivate={() => {
          window.amiba.notifier.activateMain()
          setCard(null)
        }}
        onDismiss={() => setCard(null)}
      />
    )
  }

  return (
    <ApprovalPendingCard
      tool={card.tool}
      command={card.command}
      message={card.message}
      onAllow={() => {
        window.amiba.notifier.approve(card.approvalId)
        setCard(null)
      }}
      onDeny={() => {
        window.amiba.notifier.deny(card.approvalId)
        setCard(null)
      }}
    />
  )
}

function CardShell({ children }: { children: React.ReactNode }) {
  // The outer box is the only thing the user sees — the window itself
  // is fully transparent everywhere else, so this card has to be
  // explicitly opaque (rounded, bordered, with a real shadow). The
  // 3px top strip is a `-webkit-app-region: drag` handle so the user
  // can move the card out of the way without losing interactivity on
  // the body (buttons inside are explicitly `app-no-drag`).
  return (
    <div
      className="animate-notifier-in flex h-screen w-screen items-stretch p-2"
      role="alert">
      <div className="relative flex w-full flex-col gap-2 rounded-xl border border-border bg-background px-4 py-3 pt-4 text-foreground shadow-2xl">
        <div
          className="app-drag-region absolute inset-x-0 top-0 h-2 rounded-t-xl"
          title="Drag to reposition"
        />
        {children}
      </div>
    </div>
  )
}

function CronCompletedCard({
  title,
  summary,
  onActivate,
  onDismiss,
}: {
  title?: string
  summary: string
  onActivate: () => void
  onDismiss: () => void
}) {
  return (
    <CardShell>
      <button
        type="button"
        onClick={onActivate}
        className="flex w-full flex-col items-start gap-1 text-left focus:outline-none">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title ?? "Job completed"}
          </span>
          <span className="text-[10px] text-muted-foreground">click to open</span>
        </div>
        <p className="line-clamp-3 text-sm leading-snug text-foreground">
          {summary}
        </p>
      </button>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] text-muted-foreground hover:text-foreground">
          Dismiss
        </button>
      </div>
    </CardShell>
  )
}

function ApprovalPendingCard({
  tool,
  command,
  message,
  onAllow,
  onDeny,
}: {
  tool?: string
  command?: string
  message: string
  onAllow: () => void
  onDeny: () => void
}) {
  const header = tool ?? "Approval requested"
  const detail = command ?? message
  return (
    <CardShell>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-amber-400">
          {header}
        </span>
        <p className="line-clamp-2 text-sm leading-snug text-foreground">{detail}</p>
      </div>
      <div className="mt-auto flex justify-end gap-2">
        <button
          type="button"
          onClick={onDeny}
          className="rounded-md border border-border bg-transparent px-3 py-1 text-xs text-foreground transition-colors hover:bg-muted">
          Deny
        </button>
        <button
          type="button"
          onClick={onAllow}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90">
          Allow
        </button>
      </div>
    </CardShell>
  )
}
