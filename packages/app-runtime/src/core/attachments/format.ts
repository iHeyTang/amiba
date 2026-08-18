/**
 * Render composer-time `FileAttachment`s into a plain-text block that gets
 * inlined into the user message content.
 *
 * Metadata remains durable text inside the user's own turn. Supported
 * raster images are also carried as native DSH image parts by the desktop
 * client; UTF-8 text and PDFs remain opaque-id-based and are read through
 * Amiba's DSH attachment tools.
 */

import type { FileAttachment } from "./types";

/**
 * Render an attachment list as a plain-text block suitable for appending to
 * the user message content, or `""` when the list is empty.
 */
export function formatFileAttachmentsForPrompt(
  atts: FileAttachment[],
): string {
  const ready = atts.filter((a) => a.attachmentId && !a.uploading);
  if (ready.length === 0) return "";
  const intro =
    ready.length === 1
      ? [
          "The user attached the following file. Raster image bytes are included",
          "as native image content. For text or PDF content, use the matching",
          "attachment_read_text / attachment_read_pdf tool when relevant.",
        ]
      : [
          `The user attached ${ready.length} files. Raster image bytes are included`,
          "as native image content. For text or PDF content, use the matching",
          "attachment_read_text / attachment_read_pdf tool when relevant.",
        ];
  const blocks = ready.map((att, i) => {
    const indexAttr = ready.length > 1 ? ` index="${i + 1}"` : "";
    const lines: string[] = [
      `<file-attachment${indexAttr}>`,
      `Name: ${JSON.stringify(att.name)}`,
      `Kind: ${JSON.stringify(att.kind)}`,
      `Mime: ${JSON.stringify(att.mime || "application/octet-stream")}`,
      `Size: ${att.size} bytes`,
    ];
    if (att.attachmentId) {
      lines.push(`Attachment-ID: ${JSON.stringify(att.attachmentId)}`);
    }
    lines.push("</file-attachment>");
    return lines.join("\n");
  });
  return [...intro, "", blocks.join("\n\n")].join("\n");
}
