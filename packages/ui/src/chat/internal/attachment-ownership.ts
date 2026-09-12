import { deleteAttachmentFile, type Attachment } from "@amiba/app-runtime/core";

/** UI copies share Host staging IDs; remove bytes only after the last owner releases them. */
export function deleteUnretainedAttachments(
  candidates: readonly Attachment[],
  retained: readonly Attachment[],
): void {
  const owned = new Set(retained.map(item => item.attachmentId).filter(Boolean));
  for (const item of candidates) {
    if (!item.attachmentId || owned.has(item.attachmentId)) continue;
    owned.add(item.attachmentId);
    void deleteAttachmentFile(item);
  }
}
