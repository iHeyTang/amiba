import type { CommandClaim } from "@amiba/extension-sdk";

export type CommandAttachments = ReadonlyArray<Parameters<CommandClaim["submit"]>[2][number] | { type: "file"; receiptId: string }>;

/** c291e796 declares attachments; rc.2 declares images. Keep the claim and
 * callback identity intact, selecting the payload only at the call boundary. */
export function commandAcceptsImages(claim: CommandClaim): boolean {
  return claim.attachments === true;
}

export function commandImagePayload(claim: CommandClaim, images: CommandAttachments) {
  return "attachments" in claim
    ? images.map(image => "receiptId" in image ? image : ({ ...image, type: "image" as const }))
    : images;
}

/** Both public source generations see the same admission attempt. The newer
 * total includes non-images so a command cannot accidentally ignore files. */
export function commandEnvelope(images: number, attachments: number) {
  return { images, attachments };
}
