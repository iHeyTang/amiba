import { Fragment, useEffect, useState, type ReactNode } from "react";
import { formatBytesShort, type AttachmentKind } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { Loader2, RefreshCw, X } from "lucide-react";

import { cn } from "../primitives";
import { ImagePreviewDialog, KindIcon } from "./bubble/chips";

/**
 * One gallery entry. The union lets a durable message image, a composer
 * draft image, and a plain file all flow through the SAME presentation, so
 * the bubble and the composer render attachments identically instead of
 * different image sizes and file heights on different surfaces.
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
      /**
       * Already-rendered presentation node — the user bubble invokes the
       * `conversation.message.images` seat once for the message's images and
       * embeds its output here, so plugins can take over the presentation
       * without Amiba re-framing it. When set, the gallery places the node
       * verbatim (no own tile chrome).
       */
      node?: ReactNode;
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
  /** @deprecated All attachments now share a fixed-height presentation. */
  compact?: boolean;
}

// The draft, optimistic bubble and durable bubble share these dimensions.
// Attachment count never changes an image's presentation.
const attachmentFrame =
  "relative h-16 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted/30";
const attachmentAction =
  "grid h-5 w-5 shrink-0 place-items-center rounded-md bg-background/90 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** A wrapping row of equal-height, uncropped images and file cards. */
export function AttachmentGallery({
  items,
  align = "start",
  className,
}: AttachmentGalleryProps) {
  if (items.length === 0) return null;
  return (
    <div
      data-attachment-gallery
      data-align={align}
      className={cn(
        "flex min-w-0 flex-wrap items-start gap-2",
        align === "end" && "justify-end",
        className,
      )}
    >
      {items.map((item) =>
        item.kind === "image" ? (
          item.node !== undefined ? (
            // Seat occupants retain full control over their presentation.
            <Fragment key={item.id}>{item.node}</Fragment>
          ) : (
            <AttachmentImageTile key={item.id} item={item} />
          )
        ) : (
          <GalleryFileCard key={item.id} item={item} />
        ),
      )}
    </div>
  );
}

/**
 * A constant-height image whose width follows its aspect ratio. Very wide or
 * tall images fit inside the bounded frame without cropping their contents.
 * Shared with the shell's default conversation.message.images seat occupant.
 */
export function AttachmentImageTile({
  item,
}: {
  item: Extract<AttachmentGalleryItem, { kind: "image" }>;
  /** @deprecated Accepted for existing plugin callers; tiles are always equal-height. */
  size?: "large" | "tile";
}) {
  const { t } = useT();
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    const loader = item.loadImage;
    if (!loader) return;
    void loader()
      .then((url) => {
        if (alive && typeof url === "string") setLoaded({ id: item.id, url });
      })
      .catch(() => {
        // Authorization failure / revoked draft: clear the prior preview.
        if (alive) setLoaded(null);
      });
    return () => {
      alive = false;
    };
  }, [item.id, item.loadImage]);

  const thumb = item.thumbUrl ?? (loaded?.id === item.id ? loaded.url : null);
  const preview = item.uploading ? null : (item.previewUrl ?? thumb);
  const content = thumb ? (
    <img
      src={thumb}
      alt={item.name ?? ""}
      className={cn(
        "block h-full w-auto max-w-40 object-contain",
        item.uploading && "opacity-50",
      )}
    />
  ) : (
    <span
      aria-hidden
      className="grid h-full w-16 place-items-center text-muted-foreground/70"
    >
      {!item.uploading && <KindIcon kind="image" className="h-5 w-5" />}
    </span>
  );

  return (
    <span
      data-attachment-kind="image"
      className={cn(attachmentFrame, "group inline-flex min-w-10 max-w-full")}
    >
      {preview ? (
        <ImagePreviewDialog src={preview} alt={item.name ?? ""}>
          <button
            type="button"
            title={item.name}
            className="flex h-full w-full min-w-0 items-center justify-center cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {content}
          </button>
        </ImagePreviewDialog>
      ) : (
        <span className="inline-flex h-full w-full items-center justify-center">
          {content}
        </span>
      )}
      {item.uploading && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2
            className="h-4 w-4 animate-spin text-muted-foreground"
            aria-label={t("sidepanel.attachment.uploading")}
          />
        </span>
      )}
      {item.onRemove && (
        <button
          type="button"
          onClick={item.onRemove}
          aria-label={t("sidepanel.attachment.removeAria", {
            name: item.name ?? "",
          })}
          title={t("sidepanel.attachment.remove")}
          className={cn(
            attachmentAction,
            "absolute right-1 top-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/** File details occupy the same height as an image, even with a short name. */
function GalleryFileCard({
  item,
}: {
  item: Extract<AttachmentGalleryItem, { kind: "file" }>;
}) {
  const { t } = useT();
  const extension = /\.([a-z\d]{1,12})$/i.exec(item.name)?.[1]?.toUpperCase();
  const details = [
    extension,
    item.size != null ? formatBytesShort(item.size) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      data-attachment-kind="file"
      className={cn(
        attachmentFrame,
        "group inline-flex w-56 max-w-full items-center gap-2.5 px-3",
        (item.onRemove || (item.failed && item.onRetry)) && "pr-7",
        item.failed && "border-destructive/40",
      )}
      title={item.name}
    >
      <span className="grid h-8 w-7 shrink-0 place-items-center text-muted-foreground">
        {item.uploading ? (
          <Loader2
            className="h-5 w-5 animate-spin"
            aria-label={t("sidepanel.attachment.uploading")}
          />
        ) : (
          <KindIcon kind={item.fileKind ?? "binary"} className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-xs font-medium leading-5 text-foreground/90">
          {item.name}
        </span>
        {details && (
          <span className="block truncate text-[11px] leading-4 text-muted-foreground">
            {details}
          </span>
        )}
      </span>
      <span className="absolute right-1 top-1 flex flex-col gap-1">
        {item.onRemove && (
          <button
            type="button"
            onClick={item.onRemove}
            title={t("sidepanel.attachment.remove")}
            aria-label={t("sidepanel.attachment.removeAria", {
              name: item.name,
            })}
            className={attachmentAction}
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {item.failed && item.onRetry && (
          <button
            type="button"
            onClick={item.onRetry}
            title={t("sidepanel.retry.action")}
            aria-label={t("sidepanel.retry.action")}
            className={attachmentAction}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </span>
    </span>
  );
}

/** The official `conversation.message.images` seat owner shape (subset). */
export interface MessageImagesOwner {
  images: readonly {
    attachment: import("@amiba/extension-sdk").ImageAttachmentRef;
  }[];
  loadImage?: (
    attachment: import("@amiba/extension-sdk").ImageAttachmentRef,
  ) => Promise<string>;
  align?: "start" | "end";
  compact?: boolean;
}

/**
 * Default image-seat occupant. `contents` lets each image participate in the
 * outer attachment row's wrapping, alongside file cards. Third-party seat
 * occupants remain unwrapped and continue to own their layout.
 */
export function MessageImagesGallery({ owner }: { owner: MessageImagesOwner }) {
  const { images, loadImage } = owner;
  if (images.length === 0) return null;
  return (
    <span className="contents">
      {images.map((image) => (
        <AttachmentImageTile
          key={image.attachment.attachmentId}
          item={{
            kind: "image",
            id: image.attachment.attachmentId,
            name: image.attachment.name,
            loadImage: loadImage
              ? () => loadImage(image.attachment)
              : undefined,
          }}
        />
      ))}
    </span>
  );
}
