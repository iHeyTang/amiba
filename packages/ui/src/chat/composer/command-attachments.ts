import { commandAcceptsImages, type CommandAttachments } from "./command-contract";
import type { Attachment } from "@amiba/app-runtime/core";
import { getPlatform } from "@amiba/app-runtime/platform";
import type { CommandClaim } from "@amiba/extension-sdk";

export type CommandImages = CommandAttachments;

/** Resolve original staged bytes, never a thumbnail or a Host staging id. */
export async function commandImages(
  claim: CommandClaim,
  attachments: readonly Attachment[],
  uploadFile?: (dataBase64: string, name: string) => Promise<string>,
): Promise<CommandImages> {
  if (!attachments.length) return [];
  if (attachments.some((item) => item.uploading || !item.attachmentId)) {
    throw new Error("Wait for attachments to finish uploading before submitting this command.");
  }
  if (attachments.some((item) => item.kind !== "image") && !("attachments" in claim && claim.attachments === true && uploadFile)) {
    if ("attachments" in claim && claim.attachments === true) {
      throw new Error("File attachments for this command are not available in this runtime yet.");
    }
    throw new Error("This command accepts image attachments only. Remove other files before submitting.");
  }
  if (!commandAcceptsImages(claim)) throw new Error("This command does not accept images. Remove them before submitting.");
  const adapter = getPlatform().agentAttachments;
  if (!adapter) throw new Error("DSH attachment plugin is unavailable.");
  const images: Array<CommandImages[number]> = [];
  const storedAttachments = [];
  // Validate the complete native batch before requesting any file receipts.
  for (const item of attachments) {
    const stored = await adapter.readForPrompt(item.attachmentId!);
    if (stored.attachmentId !== item.attachmentId || stored.kind !== item.kind || stored.size !== item.size) throw new Error(`Attachment ${item.name} failed image validation.`);
    if (item.kind === "image" && !["image/png","image/jpeg","image/jpg","image/webp","image/gif"].includes(stored.mime.toLowerCase())) throw new Error(`Attachment ${item.name} failed image validation.`);
    storedAttachments.push({item,stored});
  }
  for (const {item,stored} of storedAttachments) {
    if (item.kind !== "image") {
      images.push({type:"file",receiptId:await uploadFile!(stored.dataBase64,stored.name)});
      continue;
    }
    const mediaType = stored.mime.toLowerCase() === "image/jpg" ? "image/jpeg" : stored.mime.toLowerCase();
    if (stored.attachmentId !== item.attachmentId || stored.kind !== "image" || stored.size !== item.size ||
      !(mediaType === "image/png" || mediaType === "image/jpeg" || mediaType === "image/webp" || mediaType === "image/gif")) {
      throw new Error(`Attachment ${item.name} failed image validation.`);
    }
    images.push({ mediaType, data: stored.dataBase64, name: stored.name });
  }
  return images;
}
