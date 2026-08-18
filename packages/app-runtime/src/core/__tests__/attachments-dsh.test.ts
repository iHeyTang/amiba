import { describe, expect, it } from "vitest";

import {
  formatFileAttachmentsForPrompt,
  isDshNativeImage,
  readBlobAsAttachment,
} from "../attachments";

describe("DSH attachment contract", () => {
  it("accepts only DSH-native raster image formats", () => {
    expect(isDshNativeImage("screen.png", "image/png")).toBe(true);
    expect(isDshNativeImage("photo.jpg", "application/octet-stream")).toBe(true);
    expect(isDshNativeImage("vector.svg", "image/svg+xml")).toBe(false);
    expect(isDshNativeImage("photo.avif", "image/avif")).toBe(false);
  });

  it("rejects unsupported binary formats before contacting the host", async () => {
    await expect(
      readBlobAsAttachment({
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        name: "archive.zip",
        mime: "application/zip",
        options: { sessionId: "s-1" },
      }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Unsupported/u) });
  });

  it("routes text and PDFs to exact plugin tools without embedding previews", () => {
    const prompt = formatFileAttachmentsForPrompt([
      {
        uiId: "a-1",
        name: "notes.md",
        mime: "text/markdown",
        size: 12,
        kind: "text",
        attachmentId: "att_0123456789abcdef0123456789abcdef",
        textPreview: "do not leak this duplicate preview",
      },
    ]);
    expect(prompt).toContain("attachment_read_text / attachment_read_pdf");
    expect(prompt).toContain(
      'Attachment-ID: "att_0123456789abcdef0123456789abcdef"',
    );
    expect(prompt).not.toContain("do not leak");
  });
});
