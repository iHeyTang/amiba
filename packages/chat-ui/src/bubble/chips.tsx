import {
  formatBytesShort,
  type Attachment,
  type AttachmentBadge,
  type AttachmentKind
} from "@hermes-x/core"
import { useT } from "@hermes-x/i18n"
import { Button, HermesLogo } from "@hermes-x/ui"
import { cn } from "@hermes-x/utils"
import {
  ExternalLink,
  File as FileIcon,
  FileText,
  Globe,
  History,
  ImageIcon,
  Loader2,
  Plus,
  X
} from "lucide-react"

import { hostnameOf } from "../internal/helpers"
import type { ChatError } from "../internal/types"

export interface EmptyStateProps {
  onNew: () => void
  onOpenHistory: () => void
  hasHistory: boolean
}

export function EmptyState({ onNew, onOpenHistory, hasHistory }: EmptyStateProps) {
  const { t } = useT()
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <HermesLogo size={112} />
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("sidepanel.empty.title")}</p>
        <p className="text-xs text-muted-foreground">
          {hasHistory ? t("sidepanel.empty.withHistory") : t("sidepanel.empty.firstChat")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button onClick={onNew}>
          <Plus className="mr-1" />
          {t("sidepanel.empty.newChat")}
        </Button>
        {hasHistory && (
          <Button variant="outline" onClick={onOpenHistory}>
            <History className="mr-1" />
            {t("sidepanel.empty.openHistory")}
          </Button>
        )}
      </div>
    </div>
  )
}

export interface ErrorBlockProps {
  error: ChatError
  onOpenSettings: () => void
}

export function ErrorBlock({ error, onOpenSettings }: ErrorBlockProps) {
  const { t } = useT()
  return (
    <div className="w-full max-w-sm rounded-md border border-destructive/50 bg-destructive/10 p-3 text-left text-xs text-destructive">
      <div className="break-all font-mono">{error.message}</div>
      {error.hint && (
        <pre className="mt-2 whitespace-pre-wrap break-words text-foreground/90">
          {error.hint}
        </pre>
      )}
      <div className="mt-2 flex gap-2">
        <button
          onClick={onOpenSettings}
          className="inline-flex items-center gap-1 rounded border border-foreground/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground hover:bg-foreground/10">
          {t("sidepanel.empty.settings")}
        </button>
      </div>
    </div>
  )
}

export interface AgentDestinationChipProps {
  url: string
  title?: string
  /**
   * How to open the destination URL. Extension impl uses chrome.windows +
   * chrome.tabs to land in the user's main window; desktop impl uses
   * `shell.openExternal` (system default browser).
   */
  onOpen: (url: string) => void | Promise<void>
}

/**
 * "Open in my browser →" chip stamped onto a finished assistant bubble for
 * runs that happened on the agent surface. Closes the loop on the delegate-
 * and-forget pattern: user asks Hermes to look something up, lets it run in
 * the background, gets the answer, and *then* decides "I want to see this
 * myself" without re-issuing the URL.
 */
export function AgentDestinationChip({ url, title, onOpen }: AgentDestinationChipProps) {
  const { t } = useT()
  const display = title || hostnameOf(url) || url
  return (
    <button
      type="button"
      onClick={() => void onOpen(url)}
      title={t("sidepanel.attachment.openInBrowser", { name: display })}
      className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{display}</span>
    </button>
  )
}

export interface PageChipProps {
  title?: string
  url?: string
  favIconUrl?: string
  /**
   * A "live" chip is the auto-tracked current tab; styled with a dashed
   * border to telegraph that its target updates as the user switches tabs.
   * Pinned chips render solid and own a remove (×) action.
   */
  live?: boolean
  onRemove?: () => void
}

export function PageChip({ title, url, favIconUrl, live, onRemove }: PageChipProps) {
  const { t } = useT()
  const host = hostnameOf(url)
  const display = title || host || "page"
  return (
    <div
      className={cn(
        "inline-flex max-w-[180px] items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]",
        live
          ? "border-dashed border-primary/50 bg-primary/5 text-foreground/80"
          : "border-border bg-muted/40 text-muted-foreground"
      )}
      title={url ? `${display}\n${url}` : display}>
      {favIconUrl ? (
        <img
          src={favIconUrl}
          alt=""
          className="h-3 w-3 shrink-0 rounded-sm"
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = "none"
          }}
        />
      ) : (
        <Globe className="h-3 w-3 shrink-0" />
      )}
      <span className="truncate">{display}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-0.5 ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          title={t("sidepanel.attachment.remove")}
          aria-label={t("sidepanel.attachment.removePage")}>
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  )
}

export interface KindIconProps {
  kind: AttachmentKind
  className?: string
}

/**
 * Single-source-of-truth icon picker for an attachment kind. Used by both
 * the live chip and the persisted-on-bubble badge so they stay visually
 * consistent.
 */
export function KindIcon({ kind, className }: KindIconProps) {
  switch (kind) {
    case "image":
      return <ImageIcon className={className} />
    case "text":
      return <FileText className={className} />
    case "pdf":
    case "binary":
    default:
      return <FileIcon className={className} />
  }
}

export interface AttachmentChipProps {
  attachment: Attachment
  onRemove: () => void
}

/**
 * Compose-time chip for an uploaded file. Image attachments show a 20px
 * thumbnail (the full file is on disk; the chip just needs *something*
 * recognisable); text/pdf/binary attachments show a kind-appropriate icon
 * plus the filename.
 */
export function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
  const { t } = useT()
  const sizeLabel = formatBytesShort(attachment.size)
  const titleLines: string[] = []
  if (attachment.uploading) titleLines.push(t("common.loading"))
  titleLines.push(attachment.name)
  titleLines.push(`${attachment.kind} • ${sizeLabel}`)
  if (attachment.mime) titleLines.push(attachment.mime)
  if (attachment.path) titleLines.push(attachment.path)
  if (attachment.fromPageContext && attachment.sourceUrl) {
    titleLines.push(`from ${attachment.sourceUrl}`)
  }
  if (attachment.textPreview) {
    titleLines.push("")
    titleLines.push(attachment.textPreview)
  }
  return (
    <div
      className="group inline-flex h-6 max-w-[220px] items-center gap-1 rounded-full border border-border bg-muted/40 pl-0.5 pr-1 text-[11px] text-muted-foreground"
      title={titleLines.join("\n")}
      aria-busy={attachment.uploading || undefined}>
      {attachment.uploading ? (
        <span className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted/60">
          <Loader2
            className="h-3.5 w-3.5 animate-spin text-foreground"
            aria-label={t("sidepanel.attachment.uploading")}
          />
        </span>
      ) : attachment.kind === "image" && attachment.thumbDataUrl ? (
        <img
          src={attachment.thumbDataUrl}
          alt=""
          className="h-5 w-5 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          <KindIcon kind={attachment.kind} className="h-3 w-3" />
        </span>
      )}
      <span className="truncate">
        {attachment.uploading ? `${t("sidepanel.attachment.uploading")} · ` : ""}
        {attachment.name}
      </span>
      {attachment.fromPageContext && (
        <span
          className="ml-0.5 rounded-sm bg-foreground/10 px-1 text-[9px] uppercase tracking-wide text-muted-foreground"
          title={t("sidepanel.attachment.autoFrom", {
            source: attachment.sourceUrl ?? t("sidepanel.attachment.autoFrom.fallback")
          })}>
          page
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="-mr-0.5 ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        title={t("sidepanel.attachment.remove")}
        aria-label={t("sidepanel.attachment.removeAria", { name: attachment.name })}>
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

export interface AttachmentBadgeViewProps {
  badge: AttachmentBadge
}

/**
 * Persisted-on-bubble view of one attachment. Image badges render their
 * downscaled thumbnail; everything else renders a chip mirroring the
 * `pageBadges` styling so the user-bubble footer reads as one cohesive
 * "what was attached to this turn" row.
 */
export function AttachmentBadgeView({ badge }: AttachmentBadgeViewProps) {
  const titleLines: string[] = [badge.name, `${badge.kind} • ${formatBytesShort(badge.size)}`]
  if (badge.mime) titleLines.push(badge.mime)
  if (badge.path) titleLines.push(badge.path)
  if (badge.fromPageContext && badge.sourceUrl) {
    titleLines.push(`from ${badge.sourceUrl}`)
  }
  const title = titleLines.join("\n")

  if (badge.kind === "image") {
    if (badge.thumbDataUrl) {
      return (
        <img
          src={badge.thumbDataUrl}
          alt={badge.name}
          title={title}
          className="h-12 w-12 rounded-md border border-border object-cover"
        />
      )
    }
    return (
      <div
        className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground"
        title={title}>
        <ImageIcon className="h-4 w-4" />
      </div>
    )
  }
  return (
    <div
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
      title={title}>
      <KindIcon kind={badge.kind} className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{badge.name}</span>
      {badge.fromPageContext && (
        <span
          className="rounded-sm bg-foreground/10 px-1 text-[8px] uppercase tracking-wide"
          title={
            badge.sourceUrl
              ? `Auto-attached from ${badge.sourceUrl}`
              : "Auto-attached from a tab"
          }>
          page
        </span>
      )}
    </div>
  )
}
