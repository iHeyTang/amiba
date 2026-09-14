import { commandAcceptsImages } from "./command-contract";
import type { Attachment } from "@amiba/app-runtime/core";
import { getPlatform } from "@amiba/app-runtime/platform";
import type { CommandClaim } from "@amiba/extension-sdk";

export type CommandImages = Parameters<CommandClaim["submit"]>[2];

/** Resolve original staged bytes, never a thumbnail or a Host staging id. */
export async function commandImages(
  claim: CommandClaim,
  attachments: readonly Attachment[],
): Promise<CommandImages> {
  if (!attachments.length) return [];
  if (attachments.some((item) => item.uploading || !item.attachmentId)) {
    throw new Error("Wait for attachments to finish uploading before submitting this command.");
  }
  if (attachments.some((item) => item.kind !== "image")) {
    throw new Error("This command accepts image attachments only. Remove other files before submitting.");
  }
  if (!commandAcceptsImages(claim)) throw new Error("This command does not accept images. Remove them before submitting.");
  const adapter = getPlatform().agentAttachments;
  if (!adapter) throw new Error("DSH attachment plugin is unavailable.");
  const images: Array<CommandImages[number]> = [];
  for (const item of attachments) {
    const stored = await adapter.readForPrompt(item.attachmentId!);
    const mediaType = stored.mime.toLowerCase() === "image/jpg" ? "image/jpeg" : stored.mime.toLowerCase();
    if (stored.attachmentId !== item.attachmentId || stored.kind !== "image" || stored.size !== item.size ||
      !(mediaType === "image/png" || mediaType === "image/jpeg" || mediaType === "image/webp" || mediaType === "image/gif")) {
      throw new Error(`Attachment ${item.name} failed image validation.`);
    }
    images.push({ mediaType, data: stored.dataBase64, name: stored.name });
  }
  return images;
}
