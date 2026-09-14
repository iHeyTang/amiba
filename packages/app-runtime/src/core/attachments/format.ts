/** New messages use official structured attachment parts. The parser below
 * only formats existing message text; it never opens or migrates old files. */

import type { AttachmentBadge, FileAttachment } from "./types";

/**
 * Render an attachment list as a plain-text block suitable for appending to
 * the user message content, or `""` when the list is empty.
 */
export function formatFileAttachmentsForPrompt(
  _atts: FileAttachment[],
): string {
  return "";
}

/**
 * Inverse of {@link formatFileAttachmentsForPrompt}: split the envelope back
 * out of a stored user message.
 *
 * The builder inlines the envelope INTO THE SAME text block as what the user
 * typed — model-facing wire format. Rendering a reloaded transcript verbatim
 * therefore showed the preamble and blocks as if the user had written them.
 * This parser rebuilds the attachment badges and returns the user's own text.
 *
 * Builder and parser are one file ON PURPOSE: the projection's first splitter
 * lived elsewhere, was reverse-engineered from a single-file log sample, and
 * silently missed the multi-file shape (`N files` preamble, `index="…"`
 * attribute) the builder two screens up was emitting. A round-trip test now
 * pins them together. The preamble strip covers messages persisted before
 * the builder stopped emitting one. Splitting engages only when a
 * well-formed block parses;
 * any other text passes through byte-for-byte.
 */
export function splitFileAttachmentsFromPrompt(text: string): {
  text: string;
  badges: AttachmentBadge[];
} {
  const badges: AttachmentBadge[] = [];
  const BLOCK =
    /<file-attachment(?: index="\d+")?>\n([\s\S]*?)\n<\/file-attachment>/gu;
  const jsonField = (body: string, name: string): string | undefined => {
    const raw = new RegExp(`^${name}: (".*")$`, "mu").exec(body)?.[1];
    if (raw === undefined) return undefined;
    try {
      const value = JSON.parse(raw) as unknown;
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const stripped = text.replace(BLOCK, (whole, body: string) => {
    const name = jsonField(body, "Name");
    if (name === undefined) return whole; // not the builder's shape — keep it
    const attachmentId = jsonField(body, "Attachment-ID");
    const size = /^Size: (\d+) bytes$/mu.exec(body)?.[1];
    badges.push({
      uiId: attachmentId ?? `att:${badges.length}:${name}`,
      name,
      mime: jsonField(body, "Mime") ?? "application/octet-stream",
      size: size === undefined ? 0 : Number(size),
      kind: (jsonField(body, "Kind") ?? "file") as AttachmentBadge["kind"],
      ...(attachmentId === undefined ? {} : { attachmentId }),
    });
    return "";
  });
  if (badges.length === 0) return { text, badges };
  return {
    text: stripped
      // Both intro variants the builder emits, matched in full.
      .replace(
        /^The user attached (?:the following file|\d+ files)\. Raster image bytes are included\nas native image content\. For text or PDF content, use the matching\nattachment_read_text \/ attachment_read_pdf tool when relevant\.\n*/u,
        "",
      )
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
    badges,
  };
}
