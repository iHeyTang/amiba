import { commandAcceptsImages, type CommandAttachments } from "./command-contract";
import type { Attachment } from "@amiba/app-runtime/core";
import { getPlatform } from "@amiba/app-runtime/platform";
import type { CommandClaim } from "@amiba/extension-sdk";

export type CommandImages = CommandAttachments;

/** Serialize the official draft registry for the command receiving this session. */
export async function commandImages(
  claim: CommandClaim,
  attachments: readonly Attachment[],
  sessionId = "",
  signal?: AbortSignal,
): Promise<CommandImages> {
  if (!attachments.length) return [];
  if (attachments.some((item) => item.uploading || !item.attachmentId)) {
    throw new Error("Wait for attachments to finish uploading before submitting this command.");
  }
  if (attachments.some((item) => item.kind !== "image") && !("attachments" in claim && claim.attachments === true)) {
    throw new Error("This command accepts image attachments only. Remove other files before submitting.");
  }
  if (!commandAcceptsImages(claim)) throw new Error("This command does not accept images. Remove them before submitting.");
  const adapter = getPlatform().agentAttachments;
  if (!adapter?.serialize) throw new Error("Attachment drafts are unavailable. Please attach the files again.");
  const parts = await adapter.serialize(sessionId, attachments.map(item => item.attachmentId!), signal);
  return parts.filter((part): part is Extract<typeof part, { type: "image" | "file" }> => part.type === "image" || part.type === "file");
}
