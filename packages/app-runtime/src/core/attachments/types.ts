/**
 * Composer-time attachments — files the user attaches before sending the
 * next chat turn (manual upload, drag/drop, paste, or auto-attach of the
 * current tab when it isn't an HTML page).
 *
 * Storage model: **opaque-id-based, not path-based**.
 *
 * Payloads are staged by the DSH attachment plugin. PNG/JPEG/WebP/GIF bytes
 * are admitted through DSH's native image wire; UTF-8 text and PDFs are read
 * on demand through plugin tools using an opaque attachment id.
 *
 * `kind` picks the chip icon and the native-image vs. attachment-tool
 * delivery path.
 *
 * Persistence: at send time we strip the heavy fields (the original File
 * reference, large preview blobs we don't want twice in storage) and keep
 * only an `AttachmentBadge` on the message so old bubbles still render the
 * chip after a panel reload. Full image bytes are never persisted in UI
 * state; only the opaque id and an optional 256px thumbnail remain.
 */

/**
 * Presentation classification — drives chip icon, preview kind, and the
 * `kind` attribute we surface in the `<file-attachment>` metadata block so
 * the agent can route to the right tool without re-sniffing the MIME.
 */
export type AttachmentKind = "image" | "text" | "pdf" | "binary";

interface AttachmentBase {
  /** Stable id used for React keys + remove-by-id. */
  uiId: string;
  /** Original / sanitised filename. */
  name: string;
  /** Source MIME type as best we can determine it. */
  mime: string;
  /** Decoded byte size of the original file. */
  size: number;
  /** Presentation classification — see `AttachmentKind`. */
  kind: AttachmentKind;
  /**
   * Opaque id returned by the DSH attachment plugin.
   *
   * Optional only because host intake may fail (store unavailable, write
   * error, etc.) — in that case we surface the error to the user and the
   * chip is never offered for send.
   */
  attachmentId?: string;
}

export interface FileAttachment extends AttachmentBase {
  /**
   * Tiny downscaled JPEG/PNG data URL (≤ 256px longest edge) used to
   * render the chip preview for image attachments. Only set when
   * `kind === "image"`.
   */
  thumbDataUrl?: string;
  /**
   * Larger downscaled JPEG/PNG data URL (≤ 1024px longest edge) used as
   * the click-to-zoom preview source for image attachments in the
   * composer. Only set when ``kind === "image"`` and kept only in
   * compose-time state — ``attachmentToBadge`` deliberately drops it so
   * the persisted bubble's storage footprint stays small; 256px thumbs are
   * enough to recognise the sent file in history.
   */
  previewDataUrl?: string;
  /**
   * First few hundred characters of decoded text — for chip tooltips and
   * the bubble preview on text/pdf attachments. Never sent to the model;
   * the agent reads the full file from `attachmentId` if it cares.
   */
  textPreview?: string;
  /**
   * True while bytes are being staged by the DSH plugin.
   * Composer chip shows a spinner; `attachmentId` is unset until complete.
   */
  uploading?: boolean;
}

/**
 * Live-composer attachment. Today there is exactly one shape regardless of
 * file kind (the kind only changes which preview field is populated), but
 * we keep the union alias so call sites that already type against
 * `Attachment` keep compiling and so it's trivial to reintroduce shape
 * variants (e.g. an inline `image_url` flavour) later.
 */
export type Attachment = FileAttachment;

/**
 * Persisted-on-message metadata. Survives panel reload so historical
 * bubbles can still render the chip. Structurally a near-copy of
 * `FileAttachment` minus any large preview text we don't want to store
 * twice — the opaque id is the durable handle and the agent can re-read from
 * it if revisiting a saved chat.
 */
export interface AttachmentBadge {
  uiId: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  attachmentId?: string;
  /** Same 256px thumbnail as on the live attachment, for image chips. */
  thumbDataUrl?: string;
}
