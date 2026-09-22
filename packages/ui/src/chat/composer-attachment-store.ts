import type { Attachment } from "@amiba/app-runtime/core";
import type { ComposerAttachment } from "@amiba/extension-sdk";
import type { ComposerDraftImageRegistration } from "./composer/triggers/contracts";

/** Draft data and ongoing uploads outlive any particular mounted editor. */
function createAttachmentDraft() {
  let snapshot = { attachments: [] as Attachment[], busy: false, error: null as string | null };
  const listeners = new Set<() => void>();
  return {
    attachmentState: { current: snapshot.attachments },
    imageSnapshot: { current: Object.freeze([]) as readonly ComposerAttachment[] },
    uploads: { current: 0 },
    imageListeners: { current: new Set<() => void>() },
    imageAttachmentIds: { current: new Map<string, string>() },
    draftImages: { current: new Map<string, ComposerDraftImageRegistration>() },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(patch: Partial<typeof snapshot>) {
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) listener();
    },
  };
}
const drafts = new WeakMap<object, ReturnType<typeof createAttachmentDraft>>();
export function composerAttachmentDraft(scope?: object) {
  if (!scope) return createAttachmentDraft();
  let draft = drafts.get(scope);
  if (!draft) { draft = createAttachmentDraft(); drafts.set(scope, draft); }
  return draft;
}
