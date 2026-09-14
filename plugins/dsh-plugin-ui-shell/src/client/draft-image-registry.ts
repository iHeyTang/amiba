import type { CommandClaim, ComposerAttachment } from "@amiba/extension-sdk";

const mediaTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
/** Browser-only image storage implementing the pinned conversation image contract.
 * Kept separate from IConversation until the native input facade is complete.
 */
export function createDraftImageRegistry() {
  const images = new Map<ComposerAttachment["id"], ComposerAttachment>();
  let disposed = false;
  const releaseDraftImage = (id: ComposerAttachment["id"]) => {
    const image = images.get(id);
    if (!image) return;
    images.delete(id);
    URL.revokeObjectURL(image.previewUrl);
  };
  const draftImages = (ids: readonly ComposerAttachment["id"][]) =>
    ids.flatMap(id => { const image = images.get(id); return image ? [image] : []; });
  return {
    createDraftImages(files: readonly File[]): readonly ComposerAttachment[] {
      if (disposed) throw new Error("Draft image registry is disposed");
      // Validate the entire batch before allocating preview URLs.
      for (const file of files) {
        if (!mediaTypes.has(file.type)) throw new Error(`unsupported image media type: ${file.type || "(empty)"}`);
      }
      const created: ComposerAttachment[] = [];
      try {
        for (const file of files) {
          const image: ComposerAttachment = {
            kind: "image", id: crypto.randomUUID() as ComposerAttachment["id"],
            file, previewUrl: URL.createObjectURL(file),
          };
          images.set(image.id, image);
          created.push(image);
        }
        return created;
      } catch (error) {
        for (const image of created) releaseDraftImage(image.id);
        throw error;
      }
    },
    draftImages,
    async serializeDraftImages(ids: readonly ComposerAttachment["id"][]): Promise<Parameters<CommandClaim["submit"]>[2]> {
      const selected = draftImages(ids);
      if (selected.length !== ids.length) throw new Error("One or more draft images are no longer available");
      return Promise.all(selected.map(async ({ file }) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32768) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        }
        return {
          mediaType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          data: btoa(binary), ...(file.name ? { name: file.name } : {}),
        };
      }));
    },
    releaseDraftImage,
    releaseDraftImages(attachments: readonly ComposerAttachment[]) {
      for (const attachment of attachments) releaseDraftImage(attachment.id);
    },
    dispose() {
      disposed = true;
      for (const id of images.keys()) releaseDraftImage(id);
    },
  };
}
