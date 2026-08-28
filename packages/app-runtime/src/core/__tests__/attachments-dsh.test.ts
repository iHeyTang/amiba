import { describe, expect, it } from "vitest";

import {
  formatFileAttachmentsForPrompt,
  splitFileAttachmentsFromPrompt,
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
    // Blocks only: the how-to-read guidance is injected once per turn by the
    // attachments plugin's system-prompt context, not repeated per message.
    expect(prompt.startsWith("<file-attachment>")).toBe(true);
    expect(prompt).not.toContain("The user attached");
    expect(prompt).toContain(
      'Attachment-ID: "att_0123456789abcdef0123456789abcdef"',
    );
    expect(prompt).not.toContain("do not leak");
  });

  it("round-trips the envelope: format, append the text, split it back", () => {
    // Builder and parser are the two ends of one wire format we own. The
    // parser's first version lived in the history projection, was derived
    // from a single-file log sample, and missed the multi-file shape the
    // builder emits — hence a property test over BOTH variants rather than
    // fixtures of one.
    const single = [
      {
        uiId: "a1",
        name: "image.png",
        kind: "image" as const,
        mime: "image/png",
        size: 49242,
        attachmentId: "att_1",
        uploading: false,
      },
    ];
    const multi = [
      ...single,
      {
        uiId: "a2",
        name: 'weird "name".pdf',
        kind: "pdf" as const,
        mime: "application/pdf",
        size: 7,
        attachmentId: "att_2",
        uploading: false,
      },
    ];
    for (const atts of [single, multi]) {
      const prompt = `${formatFileAttachmentsForPrompt(atts as never)}\n\n这是什么`;
      const { text, badges } = splitFileAttachmentsFromPrompt(prompt);
      expect(text).toBe("这是什么");
      expect(badges.map((badge) => badge.name)).toEqual(
        atts.map((att) => att.name),
      );
      expect(badges.map((badge) => badge.attachmentId)).toEqual(
        atts.map((att) => att.attachmentId),
      );
      expect(badges.map((badge) => badge.size)).toEqual(
        atts.map((att) => att.size),
      );
    }
  });
});
