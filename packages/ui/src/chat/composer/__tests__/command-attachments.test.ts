import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "@amiba/app-runtime/core";
const read = vi.hoisted(() => vi.fn());
vi.mock("@amiba/app-runtime/platform", () => ({ getPlatform: () => ({ agentAttachments: { readForPrompt: read } }) }));
import { commandImages } from "../command-attachments";
const claim = { token: "/image ", images: true, submit: vi.fn() };
const attachment: Attachment = { uiId: "ui", attachmentId: "stored", name: "original.png", mime: "image/png", size: 3, kind: "image", thumbDataUrl: "thumbnail" };
beforeEach(() => {
  read.mockReset().mockResolvedValue({ attachmentId: "stored", name: "original.png", mime: "image/png", size: 3, kind: "image", dataBase64: "AQID" });
});
describe("command image serialization", () => {
  it("reads original staged bytes and preserves their name and media type", async () => {
    expect(await commandImages(claim, [attachment])).toEqual([{ mediaType: "image/png", name: "original.png", data: "AQID" }]);
    expect(read).toHaveBeenCalledWith("stored");
  });
  it("refuses unsupported commands before reading bytes", async () => {
    await expect(commandImages({ ...claim, images: false }, [attachment])).rejects.toThrow("does not accept images");
    expect(read).not.toHaveBeenCalled();
  });
  it("accepts the newer attachment capability while preserving original image validation", async () => {
    const modern = { name: "image", token: "/image ", attachments: true, submit: vi.fn() };
    expect(await commandImages(modern, [attachment])).toEqual([{ mediaType: "image/png", name: "original.png", data: "AQID" }]);
    read.mockClear();
    const refusing = { ...modern, attachments: false, images: true };
    await expect(commandImages(refusing, [attachment])).rejects.toThrow("does not accept images");
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps incomplete uploads and non-image files out of command submission", async () => {
    await expect(commandImages(claim, [{ ...attachment, uploading: true }])).rejects.toThrow("finish uploading");
    await expect(commandImages(claim, [{ ...attachment, kind: "pdf" }])).rejects.toThrow("image attachments only");
    expect(read).not.toHaveBeenCalled();
  });
  it.each([{ attachmentId: "other" }, { size: 4 }, { kind: "text" }, { mime: "image/svg+xml" }])("rejects mismatched stored data %j", async (patch) => {
    read.mockResolvedValue({ attachmentId: "stored", name: "original.png", mime: "image/png", size: 3, kind: "image", dataBase64: "AQID", ...patch });
    await expect(commandImages(claim, [attachment])).rejects.toThrow("failed image validation");
  });
  it("propagates staging read failure without yielding partial images", async () => {
    read.mockRejectedValue(new Error("file unavailable"));
    await expect(commandImages(claim, [attachment])).rejects.toThrow("file unavailable");
  });
});
