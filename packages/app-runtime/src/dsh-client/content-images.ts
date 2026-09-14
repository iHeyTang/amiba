import type { MessageImage } from "@amiba/app-runtime/protocol"

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Direct content images only: nested tool calls own their own galleries.
 * Preserve occurrence order and the original authorized attachment identity.
 * Inline bytes and staging IDs are not durable attachment references.
 */
export function durableContentImages(content: unknown): MessageImage[] {
  return Array.isArray(content)
    ? content.flatMap((part): MessageImage[] => {
        const item = record(part)
        return item?.type === "image" && isImageReference(item.attachment)
          ? [{ attachment: item.attachment }]
          : []
      })
    : []
}

/** Reject malformed references without minting an identity for legacy inline bytes. */
function isImageReference(value: unknown): value is MessageImage["attachment"] {
  const ref = record(value)
  const positive = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n > 0
  if (!ref || typeof ref.attachmentId !== "string" || !ref.attachmentId
    || typeof ref.mediaType !== "string"
    || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(ref.mediaType)
    || !positive(ref.bytes) || !positive(ref.width) || !positive(ref.height)
    || (ref.name !== undefined && typeof ref.name !== "string")) return false
  if (ref.originalDimensions !== undefined) {
    const dimensions = record(ref.originalDimensions)
    if (!dimensions || !positive(dimensions.width) || !positive(dimensions.height)) return false
  }
  return true
}
