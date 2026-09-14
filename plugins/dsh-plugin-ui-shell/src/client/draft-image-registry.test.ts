import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDraftImageRegistry } from "./draft-image-registry.js";
let next = 0;
const createURL = vi.fn();
const revokeURL = vi.fn();
beforeEach(() => {
  next = 0;
  createURL.mockReset().mockImplementation(() => `blob:preview-${next}`);
  revokeURL.mockReset();
  vi.stubGlobal("crypto", { randomUUID: () => `draft-${++next}` });
  vi.stubGlobal("URL", { createObjectURL: createURL, revokeObjectURL: revokeURL });
});
afterEach(() => vi.unstubAllGlobals());
function file(type = "image/png") {
  return { name: "original.png", type, arrayBuffer: async () => Uint8Array.from([0, 1, 255]).buffer } as File;
}
describe("browser draft image registry", () => {
  it("preserves File identity, ordering, and original bytes", async () => {
    const registry = createDraftImageRegistry();
    const original = file();
    const [first, second] = registry.createDraftImages([original, original]);
    expect(first.file).toBe(original);
    expect(first.id).not.toBe(second.id);
    expect(registry.draftImages([second.id, first.id])).toEqual([second, first]);
    expect(await registry.serializeDraftImages([first.id])).toEqual([{ name: "original.png", mediaType: "image/png", data: "AAH/" }]);
    expect(registry.draftImages([first.id])).toEqual([first]);
    registry.releaseDraftImage(first.id);
    registry.releaseDraftImage(first.id);
    expect(revokeURL).toHaveBeenCalledTimes(1);
    expect(registry.draftImages([first.id, second.id])).toEqual([second]);
    await expect(registry.serializeDraftImages([first.id, second.id])).rejects.toThrow("no longer available");
    registry.dispose();
    expect(revokeURL).toHaveBeenCalledTimes(2);
  });
  it("validates every MIME before allocating and rolls back partial URL creation failure", () => {
    const registry = createDraftImageRegistry();
    expect(() => registry.createDraftImages([file(), file("image/svg+xml")])).toThrow("unsupported image media type");
    expect(createURL).not.toHaveBeenCalled();
    createURL.mockImplementationOnce(() => "blob:first").mockImplementationOnce(() => { throw new Error("allocation failed"); });
    expect(() => registry.createDraftImages([file(), file()])).toThrow("allocation failed");
    expect(revokeURL).toHaveBeenCalledWith("blob:first");
    registry.dispose();
    expect(revokeURL).toHaveBeenCalledTimes(1);
  });
  it("releases descriptors and prevents creation after disposal", () => {
    const registry = createDraftImageRegistry();
    const images = registry.createDraftImages([file("image/jpeg"), file("image/webp"), file("image/gif")]);
    registry.releaseDraftImages(images);
    registry.dispose();
    registry.dispose();
    expect(revokeURL).toHaveBeenCalledTimes(3);
    expect(() => registry.createDraftImages([file()])).toThrow("disposed");
  });
});
