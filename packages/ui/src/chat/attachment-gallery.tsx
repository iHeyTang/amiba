import { useEffect, useState } from "react";
import { formatBytesShort, type AttachmentKind } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { Loader2, RefreshCw, X } from "lucide-react";

import { cn } from "../primitives";
import { ImagePreviewDialog, KindIcon } from "./bubble/chips";

/**
 * One gallery entry. The union lets a durable message image, a composer
 * draft image, and a plain file all flow through the SAME presentation, so
 * the bubble and the composer render attachments identically instead of
 * pills in one place and a gallery in another.
 */
export type AttachmentGalleryItem =
  | {
      kind: "image";
      id: string;
      name?: string;
      /**
       * Ready thumbnail URL (composer drafts carry `thumbDataUrl`, bubble
       * items carry a loaded object URL). When absent AND `loadImage` is
       * provided, the tile resolves its own preview asynchronously.
       */
      thumbUrl?: string | null;
      /**
       * Zoom source; falls back to the thumbnail when unset. Composer drafts
       * pass `previewDataUrl` so the lightbox shows the full original.
       */
      previewUrl?: string | null;
      /** Resolve a durable image reference (message images). */
      loadImage?: () => Promise<string>;
      uploading?: boolean;
      onRemove?: () => void;
    }
  | {
      kind: "file";
      id: string;
      name: string;
      fileKind?: AttachmentKind;
      size?: number;
      uploading?: boolean;
      failed?: boolean;
      onRemove?: () => void;
      onRetry?: () => void;
    };

export interface AttachmentGalleryProps {
  items: readonly AttachmentGalleryItem[];
  /** Keep the row aligned with entries that already use `justify-end`. */
  align?: "start" | "end";
  className?: string;
  /** Force compact tiles even for a lone image. */
  compact?: boolean;
}

/**
 * One compact gallery row for mixed attachments — files as chips, images as
 * bounded preview tiles. A lone image is capped at a modest preview so it
 * never towers over the surrounding text; several images collapse to uniform
 * tiles (the same language as the official composer rail). Used by the user
 * message bubble, the composer, and the empty-state composer.
 *
 * Images click-to-zoom through the shared `ImagePreviewDialog`; editable
 * entries (composer mode) show upload spinner / remove / retry affordances.
 */
export function AttachmentGallery({
  items,
  align = "start",
  className,
  compact = false,
}: AttachmentGalleryProps) {
  if (items.length === 0) return null;
  const first = items[0];
  const loneImage = !compact && items.length === 1 && first.kind === "image" && !first.uploading;
  return (
    <div
      data-attachment-gallery
      data-align={align}
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        align === "end" && "justify-end",
        className,
      )}
    >
      {items.map((item) =>
        item.kind === "image" ? (
          <GalleryImageTile key={item.id} item={item} size={loneImage ? "large" : "tile"} />
        ) : (
          <GalleryFileChip key={item.id} item={item} />
        ),
      )}
    </div>
  );
}

/**
 * Bounded image preview. `large` is the lone-image presentation (capped so a
 * single screenshot reads clearly without dominating the row); `tile` is the
 * multi-image mode (uniform squares, matching the composer rail).
 */
function GalleryImageTile({
  item,
  size,
}: {
  item: Extract<AttachmentGalleryItem, { kind: "image" }>;
  size: "large" | "tile";
}) {
  const { t } = useT();
  const [url, setUrl] = useState<string | null>(item.thumbUrl ?? null);
  useEffect(() => {
    let alive = true;
    if (!item.loadImage) return;
    void item
      .loadImage()
      .then((value) => {
        if (alive && typeof value === "string") setUrl(value);
      })
      .catch(() => {
        /* authorization failure / revoked draft: keep the placeholder */
      });
    return () => {
      alive = false;
    };
  }, [item.loadImage]);

  const thumb = url ?? item.thumbUrl ?? null;
  const preview = item.previewUrl ?? thumb;
  const boxClass = size === "large" ? "h-32 w-52 max-w-full" : "h-16 w-16";

  const body = (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border/60 bg-muted/40",
        boxClass,
      )}
    >
      {item.uploading ? (
        <Loader2
          className="h-4 w-4 animate-spin text-muted-foreground"
          aria-label={t("sidepanel.attachment.uploading")}
        />
      ) : thumb ? (
        <img src={thumb} alt={item.name ?? ""} className="h-full w-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="inline-grid h-full w-full place-items-center text-muted-foreground/70"
        >
          <KindIcon kind="image" className="h-5 w-5" />
        </span>
      )}
      {item.onRemove && (
        <button
          type="button"
          onClick={item.onRemove}
          aria-label={t("sidepanel.attachment.removeAria", { name: item.name ?? "" })}
          title={t("sidepanel.attachment.remove")}
          className="absolute right-1 top-1 z-[1] grid h-4 w-4 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80 focus:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );

  // Zoom only when there is an actual preview; an uploading / placeholder tile
  // stays inert so the click target never promises an image that is not there.
  if (!preview) return body;
  return (
    <ImagePreviewDialog src={preview} alt={item.name ?? ""}>
      <button
        type="button"
        className="group cursor-zoom-in rounded-lg ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {body}
      </button>
    </ImagePreviewDialog>
  );
}

/**
 * Compact file entry — the gallery twin of the image tiles, so a user message
 * that mixed screenshots, PDFs and notes reads as one cohesive row.
 */
function GalleryFileChip({ item }: { item: Extract<AttachmentGalleryItem, { kind: "file" }> }) {
  const { t } = useT();
  return (
    <span
      className="group inline-flex h-8 max-w-56 items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 pl-1.5 pr-1.5 text-[11px] text-muted-foreground"
      title={item.name}
    >
      {item.uploading ? (
        <span className="grid h-4 w-4 shrink-0 place-items-center">
          <Loader2
            className="h-3.5 w-3.5 animate-spin text-foreground"
            aria-label={t("sidepanel.attachment.uploading")}
          />
        </span>
      ) : (
        <span className="grid h-4 w-4 shrink-0 place-items-center">
          <KindIcon kind={item.fileKind ?? "binary"} className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="truncate">{item.name}</span>
      {item.size != null && (
        <span className="shrink-0 text-muted-foreground/70">{formatBytesShort(item.size)}</span>
      )}
      {item.failed && item.onRetry && (
        <button
          type="button"
          onClick={item.onRetry}
          title={t("sidepanel.retry.action")}
          aria-label={t("sidepanel.retry.action")}
          className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
      {item.onRemove && (
        <button
          type="button"
          onClick={item.onRemove}
          title={t("sidepanel.attachment.remove")}
          aria-label={t("sidepanel.attachment.removeAria", { name: item.name })}
          className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}