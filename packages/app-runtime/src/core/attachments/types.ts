/** Composer attachment metadata. Files and draft identities are owned by the
 * official DSH browser controller; persisted messages use official references. */

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
   * Runtime-only draft ID returned by the official DSH controller.
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
   * True while the official draft is being created.
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
