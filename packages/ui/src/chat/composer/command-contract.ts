import type { CommandClaim } from "@amiba/extension-sdk";

/** c291e796 declares attachments; rc.2 declares images. Keep the claim and
 * callback identity intact, selecting the payload only at the call boundary. */
export function commandAcceptsImages(claim: CommandClaim): boolean {
  return "attachments" in claim ? claim.attachments === true : claim.images === true;
}

export function commandImagePayload(claim: CommandClaim, images: Parameters<CommandClaim["submit"]>[2]) {
  return "attachments" in claim
    ? images.map(image => ({ ...image, type: "image" as const }))
    : images;
}

/** Both public source generations see the same admission attempt. The newer
 * total includes non-images so a command cannot accidentally ignore files. */
export function commandEnvelope(images: number, attachments: number) {
  return { images, attachments };
}
