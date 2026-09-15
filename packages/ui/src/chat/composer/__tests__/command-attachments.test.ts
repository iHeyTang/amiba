import { beforeEach, expect, it, vi } from "vitest";
import { commandImages } from "../command-attachments";
const { serialize } = vi.hoisted(() => ({ serialize: vi.fn() }));
vi.mock("@amiba/app-runtime/platform", () => ({ getPlatform: () => ({ agentAttachments: { serialize } }) }));
const file = { uiId: "one", attachmentId: "draft-one", name: "notes.pdf", mime: "application/pdf", size: 3, kind: "pdf" as const };
const claim = { token: "/test", attachments: true, submit: vi.fn() };
beforeEach(() => { serialize.mockReset(); });
it("uses the official serializer's mixed attachment order without another upload", async () => {
  const parts = [{ type: "file", receiptId: "receipt" }, { type: "image", mediaType: "image/png", data: "AQID" }];
  serialize.mockResolvedValue(parts); const upload = vi.fn();
  expect(await commandImages(claim, [file, { ...file, attachmentId: "draft-two", kind: "image" }], "session")).toEqual(parts);
  expect(serialize).toHaveBeenCalledWith("session", ["draft-one", "draft-two"], undefined); expect(upload).not.toHaveBeenCalled();
});
it("rejects attachments for a command that does not accept them", async () => {
  await expect(commandImages({ ...claim, attachments: false }, [file])).rejects.toThrow();
  expect(serialize).not.toHaveBeenCalled();
});
it("keeps the draft on upload serialization failure", async () => {
  serialize.mockRejectedValue(new Error("File upload failed"));
  await expect(commandImages(claim, [file])).rejects.toThrow("File upload failed");
});
