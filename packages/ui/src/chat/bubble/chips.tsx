import {
  formatBytesShort,
  type Attachment,
  type AttachmentBadge,
  type AttachmentKind
} from "@amiba/core"
import { useT } from "@amiba/i18n"
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  AmibaLogo,
} from "../../primitives"
import { cn } from "../../primitives"
import {
  ArrowRight,
  CircleAlert,
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
import { resolveChatErrorPresentation } from "../internal/error-presentation"
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
      <AmibaLogo size={112} />
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
  onOpenSettings: (tab?: string) => void
}

export function ErrorBlock({ error, onOpenSettings }: ErrorBlockProps) {
  const { t } = useT()
  const presentation = resolveChatErrorPresentation(error)
  return (
    <div
      role="alert"
      data-selection="text"
      data-chat-error-kind={presentation.kind}
      className="w-full max-w-lg rounded-xl border border-border/70 bg-background/90 px-3 py-2.5 text-left shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-destructive/[0.07] text-destructive/75"
        >
          <CircleAlert className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <p className="text-xs font-medium leading-5 text-foreground/90">
              {t(presentation.titleKey)}
            </p>
            {presentation.status && (
              <span className="rounded-md bg-muted/70 px-1.5 py-0.5 font-mono text-[9px] leading-none text-muted-foreground/80">
                HTTP {presentation.status}
              </span>
            )}
          </div>
          <p className="break-words text-[11px] leading-4 text-muted-foreground">
            {presentation.detail}
          </p>
          {error.hint && (
            <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-4 text-muted-foreground/80">
              {error.hint}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpenSettings(presentation.settingsTarget)}
          className="mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-muted/55 px-2.5 text-[11px] font-medium text-foreground/75 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
        >
          {t(presentation.actionKey)}
          <ArrowRight className="h-3 w-3" />
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

/**
 * Click-to-zoom modal for an image attachment. Wraps an arbitrary child
 * (the chip / badge thumbnail) so the trigger looks unchanged but gains a
 * "click to enlarge" affordance. Esc + backdrop close the dialog; the
 * image scales to fit the viewport with a small inset so it never butts
 * against the chrome.
 */
function ImagePreviewDialog({
  src,
  alt,
  children,
}: {
  src: string
  alt?: string
  children: React.ReactNode
}) {
  const { t } = useT()
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        // Strip the default modal chrome so the image is the visual subject,
        // and opt out of the stock top-right ✕ — we render our own floating
        // close button below that sits OUTSIDE the image at the corner, with
        // a translucent backdrop so it stays legible on any wallpaper / dark
        // photo / light screenshot.
        hideDefaultClose
        appearance="bare"
        className="flex w-fit max-w-[92vw] items-center justify-center"
      >
        <img
          src={src}
          alt={alt ?? ""}
          className="block max-h-[90vh] max-w-[92vw] rounded-md object-contain shadow-2xl"
        />
        <DialogClose asChild>
          <button
            type="button"
            aria-label={t("common.close")}
            title={t("common.close")}
            className={cn(
              // Pinned to the viewport's top-right (the overlay covers the
              // whole viewport, so this anchors against the overlay corner,
              // not the image — feels more like a real lightbox close).
              // z-[60] sits above DialogContent's z-50.
              "fixed right-4 top-4 z-[60] inline-flex h-9 w-9 items-center justify-center",
              // Resting state stays subtle so it doesn't fight the image
              // for attention; hover/focus pops it to full contrast.
              "rounded-full bg-black/25 text-white/80 shadow-md backdrop-blur-sm",
              "transition-colors hover:bg-black/70 hover:text-white focus:outline-none focus-visible:bg-black/70 focus-visible:text-white focus-visible:ring-2 focus-visible:ring-white/60",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
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
      className="group inline-flex h-6 max-w-[80px] items-center gap-1 rounded-full border border-border bg-muted/40 pl-0.5 pr-1 text-[11px] text-muted-foreground"
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
        <ImagePreviewDialog
          src={
            (attachment as { previewDataUrl?: string }).previewDataUrl ??
            attachment.thumbDataUrl
          }
          alt={attachment.name}
        >
          <button
            type="button"
            // The wrapper button keeps the chip click target accessible
            // and tells the user there's an interaction. ``focus-visible``
            // ring matches the rest of the composer chrome.
            className="h-5 w-5 shrink-0 cursor-zoom-in rounded-full ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            aria-label={t("sidepanel.attachment.previewAria", { name: attachment.name })}
            title={t("sidepanel.attachment.previewTooltip")}
          >
            <img
              src={attachment.thumbDataUrl}
              alt=""
              className="h-5 w-5 rounded-full object-cover"
            />
          </button>
        </ImagePreviewDialog>
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
 * Persisted-on-bubble view of one attachment. Every kind renders as the
 * same small pill chip so a user message that mixed images, PDFs,
 * spreadsheets, etc. reads as one row of equal-weight badges. The icon
 * slot adapts:
 *
 * - image with a thumbnail → tiny round thumb (recognisable at a
 *   glance), whole chip is click-to-zoom via ``ImagePreviewDialog``.
 * - image without a thumbnail → generic ``ImageIcon``, chip is inert.
 * - text / pdf / binary → ``KindIcon`` glyph, chip is inert.
 *
 * Mirrors the styling of ``pageBadges`` so the user-bubble footer reads
 * as one cohesive "what was attached to this turn" row.
 */
export function AttachmentBadgeView({ badge }: AttachmentBadgeViewProps) {
  const titleLines: string[] = [badge.name, `${badge.kind} • ${formatBytesShort(badge.size)}`]
  if (badge.mime) titleLines.push(badge.mime)
  if (badge.path) titleLines.push(badge.path)
  if (badge.fromPageContext && badge.sourceUrl) {
    titleLines.push(`from ${badge.sourceUrl}`)
  }
  const title = titleLines.join("\n")

  const isClickableImage = badge.kind === "image" && !!badge.thumbDataUrl

  // Single pill template. Image variant uses ``pl-0.5`` to give the
  // thumbnail an inset that lines up with the icon-variant text.
  const pillClass = cn(
    "inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-background/70 text-[10px] text-muted-foreground",
    isClickableImage
      ? "py-0.5 pl-0.5 pr-2 ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      : "px-2 py-0.5",
  )

  const iconSlot =
    badge.kind === "image" && badge.thumbDataUrl ? (
      <img
        src={badge.thumbDataUrl}
        alt=""
        className="h-3.5 w-3.5 shrink-0 rounded-full border border-border object-cover"
      />
    ) : (
      <KindIcon kind={badge.kind} className="h-2.5 w-2.5 shrink-0" />
    )

  const body = (
    <>
      {iconSlot}
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
    </>
  )

  // Image-with-thumbnail badges open the click-to-zoom modal. The
  // ImagePreviewDialog wraps a single trigger child via `asChild`, so we
  // hand it a button styled identically to the inert div below.
  if (isClickableImage && badge.thumbDataUrl) {
    return (
      <ImagePreviewDialog src={badge.thumbDataUrl} alt={badge.name}>
        <button
          type="button"
          title={title}
          className={cn(pillClass, "cursor-zoom-in")}>
          {body}
        </button>
      </ImagePreviewDialog>
    )
  }

  return (
    <div className={pillClass} title={title}>
      {body}
    </div>
  )
}
