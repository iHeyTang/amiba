import { useEffect, useState } from "react";
import type { ImageAttachmentRef } from "@amiba/extension-sdk";

/**
 * Amiba's fallback presence for the OFFICIAL `conversation.message.images`
 * slot: every image renders as a capsule pill (small thumbnail + name).
 * Amiba's own user bubble uses `messageImageLoader` (the session-bound
 * loader) to render the unified AttachmentGallery instead; this occupant
 * only serves hosts that dispatch the seat WITHOUT providing a loader, so
 * the attachment row still shows a coherent capsule row there.
 *
 * See `installMessageImagesDefault` in the shell: the default is registered
 * at a HIGH priority because cell shadowing elects the LOWEST priority
 * occupant — a plugin registering at `0` (or lower) takes this seat over and
 * replaces the capsule with its own image presentation.
 */
export function CapsuleMessageImages({
  owner,
}: {
  owner: CapsuleMessageImagesOwner;
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5"
      data-amiba-message-image-capsules
    >
      {owner.images.map((image) => (
        <CapsuleImage
          key={image.attachment.attachmentId}
          image={image}
          owner={owner}
        />
      ))}
    </span>
  );
}

export interface CapsuleMessageImagesOwner {
  images: readonly { attachment: ImageAttachmentRef }[];
  loadImage?: (attachment: ImageAttachmentRef) => Promise<string>;
  align?: "start" | "end";
  compact?: boolean;
}

const pillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  maxWidth: 168,
  minWidth: 0,
  border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))",
  background: "var(--dsw-specific-input-major, #fff)",
  borderRadius: 999,
  padding: "2px 10px 2px 4px",
  fontSize: 12,
  lineHeight: "20px",
  color: "var(--dsw-alias-label-primary, inherit)",
  overflow: "hidden",
};

function CapsuleImage({
  image,
  owner,
}: {
  image: { attachment: ImageAttachmentRef };
  owner: CapsuleMessageImagesOwner;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!owner.loadImage) return;
    void owner
      .loadImage(image.attachment)
      .then((value) => {
        if (alive && typeof value === "string") setUrl(value);
      })
      .catch(() => {
        /* authorization failure or a revoked draft: keep the icon */
      });
    return () => {
      alive = false;
    };
  }, [image.attachment, owner.loadImage]);

  const name = image.attachment.name?.trim() || "image";
  return (
    <span className="min-w-0" style={pillStyle} title={name}>
      {url ? (
        <img
          src={url}
          alt={name}
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            objectFit: "cover",
            flex: "none",
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            flex: "none",
            display: "inline-grid",
            placeItems: "center",
            fontSize: 11,
            background: "var(--dsw-alias-interactive-bg-hover, #eef1f4)",
          }}
        >
          🖼
        </span>
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}
