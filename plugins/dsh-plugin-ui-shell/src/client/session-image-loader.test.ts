import { describe, expect, it, vi } from "vitest";
import type { ImageAttachmentRef } from "@amiba/extension-sdk";
import { createSessionImageLoader } from "./session-image-loader";
const image: ImageAttachmentRef = { attachmentId: "image" as ImageAttachmentRef["attachmentId"], mediaType: "image/png", bytes: 3, width: 1, height: 1 };
const success = () => ({ ok: true as const, value: { attachment: image, data: new Uint8Array([1, 2, 3]) } });
const urls = () => ({ create: vi.fn(() => "blob:test"), revoke: vi.fn() });
describe("authorized session image loader", () => {
  it("shares pending reads and exposes the synchronous cache only after authorization", async () => {
    const readAttachment = vi.fn(async () => success());
    const url = urls(); const scope = createSessionImageLoader({ readAttachment }, url);
    const first = scope.loadImage(image);
    expect(scope.loadImage(image)).toBe(first);
    expect(scope.loadImage.peek(image)).toBeUndefined();
    expect(await first).toBe("blob:test");
    expect(scope.loadImage.peek(image)).toBe("blob:test");
    expect(readAttachment).toHaveBeenCalledTimes(1);
    expect(readAttachment).toHaveBeenCalledWith(image.attachmentId);
    expect(url.create).toHaveBeenCalledTimes(1);
    expect(url.create).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "image/png");
    scope.dispose(); scope.dispose();
    expect(url.revoke).toHaveBeenCalledTimes(1);
    expect(url.revoke).toHaveBeenCalledWith("blob:test");
    expect(scope.loadImage.peek(image)).toBeUndefined();
    await expect(scope.loadImage(image)).rejects.toThrow("released");
  });
  it("does not reuse an authorized image in a different session", async () => {
    const allowed = createSessionImageLoader({ readAttachment: vi.fn(async () => success()) }, urls());
    const deniedRead = vi.fn(async () => ({ ok: false as const, error: { code: "not-found", message: "not referenced by this session" } }));
    const denied = createSessionImageLoader({ readAttachment: deniedRead as never }, urls());
    await allowed.loadImage(image);
    expect(denied.loadImage.peek(image)).toBeUndefined();
    await expect(denied.loadImage(image)).rejects.toThrow("not referenced");
    expect(deniedRead).toHaveBeenCalledTimes(1);
    allowed.dispose(); denied.dispose();
  });
  it("retries failed reads without caching the rejection", async () => {
    const readAttachment = vi.fn().mockRejectedValueOnce(new Error("disconnected")).mockResolvedValue(success());
    const scope = createSessionImageLoader({ readAttachment }, urls());
    await expect(scope.loadImage(image)).rejects.toThrow("disconnected");
    await expect(scope.loadImage(image)).resolves.toBe("blob:test");
    expect(readAttachment).toHaveBeenCalledTimes(2); scope.dispose();
  });
  it("never creates a URL for a response arriving after scope release", async () => {
    let resolve!: (result: ReturnType<typeof success>) => void;
    const readAttachment = vi.fn(() => new Promise<ReturnType<typeof success>>(done => { resolve = done; }));
    const url = urls(); const scope = createSessionImageLoader({ readAttachment }, url);
    const pending = scope.loadImage(image); await Promise.resolve();
    scope.dispose(); resolve(success());
    await expect(pending).rejects.toThrow("released");
    expect(url.create).not.toHaveBeenCalled(); expect(url.revoke).not.toHaveBeenCalled();
  });
  it("rejects a mismatched response instead of displaying another attachment", async () => {
    const result = success(); result.value.attachment = { ...image, attachmentId: "different" as ImageAttachmentRef["attachmentId"] };
    const url = urls(); const scope = createSessionImageLoader({ readAttachment: async () => result }, url);
    await expect(scope.loadImage(image)).rejects.toThrow("identity mismatch");
    expect(url.create).not.toHaveBeenCalled(); scope.dispose();
  });
});
