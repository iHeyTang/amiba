import { deleteAttachmentFile, isAttachmentReadOk, readFileAsAttachment, type Attachment } from "@amiba/app-runtime/core";
import type { ComposerDraftImageRegistration } from "@amiba/ui";

export interface PreparedInputImages {
  readonly attachments: readonly Attachment[];
  /** Release the submission's hold; this does not consume the input images. */
  release(): void;
}
interface Entry {
  sessionId: string;
  image: ComposerDraftImageRegistration;
  pending?: Promise<Attachment>;
  attachment?: Attachment;
  released: boolean;
  transferred: boolean;
  uses: number;
}

/** One native upload per resident image occurrence, retained across failed sends. */
export function createResidentImageStaging(changed: (sessionId: string) => void, deps = {
  async stage(image: ComposerDraftImageRegistration, sessionId: string): Promise<Attachment> {
    const result = await readFileAsAttachment(image.image.file, { sessionId });
    if (!isAttachmentReadOk(result)) throw new Error(`${result.name}: ${result.error}`);
    return result.attachment;
  },
  remove: (attachment: Attachment) => { void deleteAttachmentFile(attachment); },
}) {
  const entries = new WeakMap<ComposerDraftImageRegistration, Entry>();
  const cleanup = (entry: Entry) => {
    if (!entry.released || entry.uses || entry.transferred || !entry.attachment) return;
    const attachment = entry.attachment;
    entry.attachment = undefined;
    deps.remove(attachment);
  };
  const stage = (entry: Entry): Promise<Attachment> => {
    if (entry.attachment) return Promise.resolve(entry.attachment);
    if (entry.pending) return entry.pending;
    entry.pending = Promise.resolve().then(() => deps.stage(entry.image, entry.sessionId)).then(attachment => {
      entry.attachment = Object.freeze({ ...attachment });
      cleanup(entry);
      return attachment;
    }).finally(() => {
      entry.pending = undefined;
      changed(entry.sessionId);
    });
    return entry.pending;
  };
  return {
    wrap(sessionId: string, image: ComposerDraftImageRegistration): ComposerDraftImageRegistration {
      const entry: Entry = { sessionId, image, released: false, transferred: false, uses: 0 };
      const wrapped: ComposerDraftImageRegistration = {
        image: image.image,
        get prepared() { return entry.attachment; },
        release() {
          if (entry.released) return;
          entry.released = true;
          image.release();
          cleanup(entry);
        },
      };
      entries.set(wrapped, entry);
      return wrapped;
    },
    busy(image: ComposerDraftImageRegistration): boolean {
      const entry = entries.get(image);
      return !!entry && (!!entry.pending || entry.uses > 0);
    },
    transfer(image: ComposerDraftImageRegistration) {
      const entry = entries.get(image);
      if (entry) entry.transferred = true;
    },
    async acquire(images: readonly ComposerDraftImageRegistration[], signal?: AbortSignal): Promise<PreparedInputImages> {
      signal?.throwIfAborted();
      const selected = images.map(image => {
        const entry = entries.get(image);
        if (!entry || entry.released || entry.transferred) throw new Error("Resident image is no longer available for preparation.");
        return entry;
      });
      for (const entry of selected) entry.uses++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        for (const entry of selected) {
          entry.uses--;
          cleanup(entry);
          changed(entry.sessionId);
        }
      };
      try {
        const pending = Promise.all(selected.map(stage));
        const attachments = await new Promise<Attachment[]>((resolve, reject) => {
          const abort = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
          signal?.addEventListener("abort", abort, { once: true });
          void pending.then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
          if (signal?.aborted) abort();
        });
        return { attachments: Object.freeze(attachments), release };
      } catch (error) {
        release();
        throw error;
      }
    },
  };
}
