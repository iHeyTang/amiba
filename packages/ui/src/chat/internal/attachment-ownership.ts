import { deleteAttachmentFile, type Attachment } from "@amiba/app-runtime/core";

const sendingReferences = new Map<string, number>();
const draftReferences = new Map<string, number>();
const draftOwners = new WeakMap<object, Set<string>>();

/** Offscreen drafts still own staged bytes, including copies also in a queue. */
export function retainDraftAttachments(owner: object, attachments: readonly Attachment[]) {
  const previous = draftOwners.get(owner) ?? new Set<string>();
  const next = new Set(attachments.flatMap(item => item.attachmentId ? [item.attachmentId] : []));
  for (const id of previous) {
    if (next.has(id)) continue;
    const count = (draftReferences.get(id) ?? 1) - 1;
    if (count > 0) draftReferences.set(id, count);
    else draftReferences.delete(id);
  }
  for (const id of next) if (!previous.has(id)) draftReferences.set(id, (draftReferences.get(id) ?? 0) + 1);
  draftOwners.set(owner, next);
}


/** Keep files readable across preparation, session handoff and engine submission. */
export async function withSendingAttachments<T>(
  attachments: readonly Attachment[],
  use: () => Promise<T>,
): Promise<T> {
  const ids = new Set(attachments.filter(item => !item.uploading).map(item => item.attachmentId).filter((id): id is string => !!id));
  for (const id of ids) sendingReferences.set(id, (sendingReferences.get(id) ?? 0) + 1);
  try {
    return await use();
  } finally {
    for (const id of ids) {
      const count = (sendingReferences.get(id) ?? 1) - 1;
      if (count > 0) sendingReferences.set(id, count);
      else sendingReferences.delete(id);
    }
  }
}

/** UI copies share Host staging IDs; retained drafts and active sends keep bytes alive. */
export function deleteUnretainedAttachments(
  candidates: readonly Attachment[],
  retained: readonly Attachment[],
): void {
  const owned = new Set(retained.map(item => item.attachmentId).filter(Boolean));
  for (const item of candidates) {
    if (!item.attachmentId || owned.has(item.attachmentId) || sendingReferences.has(item.attachmentId) || draftReferences.has(item.attachmentId)) continue;
    owned.add(item.attachmentId);
    void deleteAttachmentFile(item);
  }
}
