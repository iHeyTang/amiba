import { describe, expect, it, vi } from "vitest";
import { setPlatform } from "../../platform/index.js";
import { formatFileAttachmentsForPrompt, isDshNativeImage, readBlobAsAttachment } from "../attachments";
describe("official attachment intake", () => {
  it("keeps image admission distinct from generic files", () => {
    expect(isDshNativeImage("screen.png", "image/png")).toBe(true);
    expect(isDshNativeImage("vector.svg", "image/svg+xml")).toBe(false);
  });
  it("allows generic binary uploads through the official adapter", async () => {
    const put = vi.fn(async () => ({ attachmentId: "official-draft" }));
    setPlatform({ agentAttachments: { put } } as any);
    const result = await readBlobAsAttachment({ blob: new Blob([new Uint8Array([1,2,3])]), name: "archive.zip", mime: "application/zip", options: { sessionId: "s1" } });
    expect(result).toMatchObject({ ok: true, attachment: { attachmentId: "official-draft", kind: "binary" } });
    expect(put).toHaveBeenCalledOnce();
  });
  it("does not inject custom IDs or tool instructions into the model prompt", () => {
    expect(formatFileAttachmentsForPrompt([{ uiId: "one", name: "notes.pdf", mime: "application/pdf", size: 2, kind: "pdf", attachmentId: "draft" }])).toBe("");
  });
});
