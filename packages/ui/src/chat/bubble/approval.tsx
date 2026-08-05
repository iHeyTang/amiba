import {
  HERMES_APPROVAL_GATEWAY_TIMEOUT_MS,
  type ApprovalOutcome,
  type ApprovalRecord,
  type HermesApprovalDecision,
  type HermesApprovalRequest
} from "@amiba/core"
import { type TranslateFn, useT } from "@amiba/i18n"
import { cn } from "../../primitives"
import { Loader2, ShieldAlert, X } from "lucide-react"
import { useEffect, useState } from "react"

interface ApprovalDecisionMeta {
  value: HermesApprovalDecision
  label: string
  description: string
  variant: "neutral" | "destructive"
}

function approvalDecisions(t: TranslateFn): ApprovalDecisionMeta[] {
  return [
    {
      value: "once",
      label: t("sidepanel.permission.allowOnce"),
      description: t("sidepanel.permission.allowOnce.desc"),
      variant: "neutral"
    },
    {
      value: "session",
      label: t("sidepanel.permission.allowSession"),
      description: t("sidepanel.permission.allowSession.desc"),
      variant: "neutral"
    },
    {
      value: "always",
      label: t("sidepanel.permission.allowAlways"),
      description: t("sidepanel.permission.allowAlways.desc"),
      variant: "neutral"
    },
    {
      value: "deny",
      label: t("sidepanel.permission.deny"),
      description: t("sidepanel.permission.deny.desc"),
      variant: "destructive"
    }
  ]
}

function presentApprovalDescription(description: string, t: TranslateFn): string {
  switch (description) {
    case "command parser limit or malformed executable payload":
      return t("sidepanel.permission.reason.unverifiedEmbeddedScript")
    case "command parser limit exceeded":
      return t("sidepanel.permission.reason.parserLimit")
    default:
      return description
  }
}

interface ApprovalOutcomeMeta {
  label: string
  tooltip: string
  className: string
}

function approvalOutcomeInfo(t: TranslateFn): Record<ApprovalOutcome, ApprovalOutcomeMeta> {
  return {
    once: {
      label: t("sidepanel.permission.allowedOnce"),
      tooltip: t("sidepanel.permission.allowedOnce.tooltip"),
      className: "border-foreground/20 bg-foreground/[0.04] text-foreground"
    },
    session: {
      label: t("sidepanel.permission.allowedSession"),
      tooltip: t("sidepanel.permission.allowedSession.tooltip"),
      className: "border-foreground/20 bg-foreground/[0.04] text-foreground"
    },
    always: {
      label: t("sidepanel.permission.allowedAlways"),
      tooltip: t("sidepanel.permission.allowedAlways.tooltip"),
      className: "border-foreground/20 bg-foreground/[0.04] text-foreground"
    },
    deny: {
      label: t("sidepanel.permission.denied"),
      tooltip: t("sidepanel.permission.denied.tooltip"),
      className: "border-destructive/30 bg-destructive/5 text-destructive"
    },
    expired: {
      label: t("sidepanel.permission.expired"),
      tooltip: t("sidepanel.permission.expired.tooltip"),
      className: "border-border bg-muted/40 text-muted-foreground"
    },
    failed: {
      label: t("sidepanel.permission.submitFailed"),
      tooltip: t("sidepanel.permission.submitFailed.tooltip", { runId: "{run_id}" }),
      className: "border-destructive/30 bg-destructive/5 text-destructive"
    }
  }
}

export interface ApprovalBannerProps {
  approvals: HermesApprovalRequest[]
  inFlight: Record<string, HermesApprovalDecision>
  error: string | null
  onRespond: (request: HermesApprovalRequest, decision: HermesApprovalDecision) => void
  onDismissError: () => void
}

/**
 * Gateway approval prompts. Sits above the queue/composer so the user
 * can't miss it — the agent is genuinely blocked on the gateway side
 * until they choose. Four decisions match Hermes's wire format:
 *
 *   - `once`    — allow this specific call only
 *   - `session` — allow for the rest of this chat session
 *   - `always`  — persist as an approved pattern for this user
 *   - `deny`    — refuse; agent gets an error from the tool
 */
export function ApprovalBanner({
  approvals,
  inFlight,
  error,
  onRespond,
  onDismissError
}: ApprovalBannerProps) {
  const { t } = useT()
  const decisions = approvalDecisions(t)
  return (
    <div className="relative z-0 mx-4 -mb-2.5 overflow-hidden rounded-t-[14px] border border-b-0 border-border/45 bg-muted/45 pb-2.5 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.5)] backdrop-blur-xl dark:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]">
      {error && (
        <div className="mx-4 mt-3 flex items-start justify-between gap-2 rounded-lg bg-destructive/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-destructive">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
            aria-label={t("sidepanel.permission.dismissError")}>
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="divide-y divide-border/45">
        {approvals.map((req) => {
          const pending = inFlight[req.approvalId]
          const command = (req.command ?? "").trim()
          const rawDescription = (req.description ?? req.reason ?? "").trim()
          const description = presentApprovalDescription(rawDescription, t)
          const tsField = (req.raw as Record<string, unknown> | undefined)
            ?.timestamp
          const requestedAt =
            typeof tsField === "number" ? tsField * 1000 : Date.now()
          return (
            <section
              key={req.approvalId}
              aria-label={t("sidepanel.permission.approvalNeeded")}
              className="relative px-4 pb-3.5 pt-2.5">
              <div className="flex items-start gap-2">
                <ApprovalCountdownBar
                  requestedAt={requestedAt}
                  timeoutMs={HERMES_APPROVAL_GATEWAY_TIMEOUT_MS}
                />
                <div className="flex min-w-0 flex-1 items-start gap-1.5">
                  <p
                    title={description !== rawDescription ? rawDescription : undefined}
                    className="min-w-0 flex-1 break-words text-[11px] leading-relaxed text-foreground/70">
                    {description || t("sidepanel.permission.approvalNeeded")}
                  </p>
                  {req.tool && (
                    <span className="shrink-0 truncate font-mono text-[10px] leading-relaxed text-muted-foreground/65">
                      {req.tool}
                    </span>
                  )}
                </div>
              </div>

              {command && (
                <pre
                  data-selection="text"
                  className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border/40 bg-background/65 px-3 py-2.5 font-mono text-xs leading-[1.55] text-foreground/85 [overflow-wrap:anywhere]">
                  {command}
                </pre>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {decisions.map((d) => {
                  const isPending = pending === d.value
                  const anyPending = pending != null
                  return (
                    <button
                      key={d.value}
                      type="button"
                      disabled={anyPending}
                      onClick={() => onRespond(req, d.value)}
                      title={d.description}
                      className={cn(
                        "inline-flex h-8 select-none items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-medium transition-[background-color,color,opacity] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
                        d.variant === "neutral" &&
                          "bg-background/65 text-foreground/70 hover:bg-background hover:text-foreground",
                        d.variant === "destructive" &&
                          "ml-auto text-destructive/85 hover:bg-destructive/[0.07] hover:text-destructive",
                        anyPending && "cursor-not-allowed opacity-50",
                        isPending && "opacity-100"
                      )}>
                      {isPending && (
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                      )}
                      <span>{d.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Compact radial countdown for an approval request. Keeping time attached to
 * the approval icon avoids turning the card edge into a false divider.
 */
export function ApprovalCountdownBar({
  requestedAt,
  timeoutMs
}: {
  requestedAt: number
  timeoutMs: number
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 500)
    return () => window.clearInterval(id)
  }, [])
  const elapsed = Date.now() - requestedAt
  const remaining = Math.max(0, timeoutMs - elapsed)
  const percent = timeoutMs > 0 ? (remaining / timeoutMs) * 100 : 0
  const warning = remaining > 0 && remaining < 30_000
  const circumference = 2 * Math.PI * 10.5
  const dashOffset = circumference * (1 - percent / 100)
  return (
    <div
      aria-hidden
      className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background/60 text-warning">
      <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 24 24">
        <circle
          cx="12"
          cy="12"
          r="10.5"
          fill="none"
          strokeWidth="1.25"
          className="stroke-border/70"
        />
        <circle
          cx="12"
          cy="12"
          r="10.5"
          fill="none"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={cn(
            "transition-[stroke-dashoffset,stroke] duration-500 ease-linear",
            remaining === 0
              ? "stroke-destructive/55"
              : warning
                ? "stroke-destructive/65"
                : "stroke-warning/70"
          )}
        />
      </svg>
      <ShieldAlert className="h-3 w-3" />
    </div>
  )
}

/**
 * Single approval chip — outcome badge + truncated command + timestamp.
 * Used both inline in the assistant timeline (so the approval reads as
 * part of the conversation flow) and at the bottom of the bubble when
 * the verbose timeline isn't being rendered.
 */
export function ApprovalRecordChip({ record }: { record: ApprovalRecord }) {
  const { t } = useT()
  const command = (record.command ?? "").trim()
  const outcomes = approvalOutcomeInfo(t)
  const meta = record.outcome ? outcomes[record.outcome] : null
  const tsMs = record.decidedAt ?? record.requestedAt
  let timeLabel = ""
  try {
    timeLabel = new Date(tsMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  } catch {
    // Bad timestamp — ignore.
  }
  const tooltipBits: string[] = []
  if (record.tool)
    tooltipBits.push(t("sidepanel.permission.chip.tool", { tool: record.tool }))
  if (command) tooltipBits.push(t("sidepanel.permission.chip.command", { command }))
  if (record.description)
    tooltipBits.push(t("sidepanel.permission.chip.reason", { reason: record.description }))
  if (meta) tooltipBits.push(meta.tooltip)
  tooltipBits.push(
    t("sidepanel.permission.chip.requested", {
      time: new Date(record.requestedAt).toLocaleString()
    })
  )
  if (record.decidedAt) {
    tooltipBits.push(
      t("sidepanel.permission.chip.decided", {
        time: new Date(record.decidedAt).toLocaleString()
      })
    )
  }
  return (
    <div title={tooltipBits.join("\n")} className="flex items-center gap-1.5 text-[10.5px] leading-none">
      <span
        className={cn(
          "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 font-medium",
          meta ? meta.className : "border-border bg-muted/30 text-muted-foreground"
        )}>
        {!meta && <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" aria-hidden />}
        <span>{meta ? meta.label : t("sidepanel.permission.waiting")}</span>
      </span>
      {command && (
        <code className="min-w-0 flex-1 truncate font-mono text-foreground/65">{command}</code>
      )}
      {timeLabel && (
        <span className="shrink-0 tabular-nums text-muted-foreground/60">{timeLabel}</span>
      )}
    </div>
  )
}

/**
 * Compact audit trail for callers that need to render approval records as a
 * group. Bubble normally places each record in the local execution trace.
 */
export function ApprovalRecordList({ records }: { records: ApprovalRecord[] }) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      {records.map((rec) => (
        <ApprovalRecordChip key={rec.approvalId} record={rec} />
      ))}
    </div>
  )
}
