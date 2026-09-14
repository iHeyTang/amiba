import { resolve } from "node:path";
import { AttachmentError, isAttachmentError } from "./error.js";
import { readFileStreamVerbatim, saveFileStreamVerbatim, saveFileVerbatim, storedFilePath } from "./file-store.js";
import type { FileAttachmentRef, SaveFileAttachment, SaveFileStreamAttachment } from "./types.js";

export type { FileAttachmentRef, SaveFileAttachment, SaveFileStreamAttachment } from "./types.js";

/** The public file half only; the existing image service remains its owner. */
export function createOfficialFileStorage(root: string) {
  const directory = resolve(root);
  return {
    saveFile: (input: SaveFileAttachment) => saveFileVerbatim(directory, input),
    saveFileStream: (input: SaveFileStreamAttachment) => saveFileStreamVerbatim(directory, input),
    readFileStream: (ref: FileAttachmentRef, signal?: AbortSignal) => readFileStreamVerbatim(directory, ref, signal),
    fileHostPath: (ref: FileAttachmentRef) => storedFilePath(directory, ref),
    async admitEncodedFile(input: { data: string; name?: string }) {
      if (typeof input.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) {
        throw new AttachmentError("File upload is not canonical base64.", "INVALID_FILE_BASE64");
      }
      const data = Buffer.from(input.data, "base64");
      if (data.toString("base64") !== input.data) throw new AttachmentError("File upload is not canonical base64.", "INVALID_FILE_BASE64");
      return saveFileVerbatim(directory, { data, ...(input.name === undefined ? {} : { name: input.name }) });
    },
    isAttachmentError,
  };
}

/** Add file capability to an rc.2 instance, never replace an existing backend.
 * The owning Cordis scope calls the disposer when either plugin is unloaded. */
export function installOfficialFileStorage(service: object, root: string): () => void {
  if (["saveFile", "saveFileStream", "readFileStream", "fileHostPath", "admitEncodedFile"].some(name => name in service)) return () => {};
  const installed = new Map<string, unknown>();
  const target = service as Record<string, unknown>;
  const dispose = () => {
    for (const [name, value] of installed) {
      // Cordis wraps methods on property reads; compare the installed descriptor
      // so scope binding cannot make our own method look like a replacement.
      if (Object.getOwnPropertyDescriptor(target, name)?.value === value) delete target[name];
    }
    installed.clear();
  };
  try {
    for (const [name, value] of Object.entries(createOfficialFileStorage(root))) {
      if (name in target) continue;
      Object.defineProperty(target, name, { value, configurable: true, writable: true });
      installed.set(name, value);
    }
  } catch (error) { dispose(); throw error; }
  return dispose;
}
