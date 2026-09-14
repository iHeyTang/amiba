import { expect, it, vi } from "vitest";
import type { Attachment } from "@amiba/app-runtime/core";
import type { ComposerDraftImageRegistration } from "@amiba/ui";
import { createResidentImageStaging } from "./resident-image-staging.js";

const attachment: Attachment = { uiId: "staged", attachmentId: "host-file", kind: "image", name: "a.png", mime: "image/png", size: 3, uploading: false };
function fixture(stage = vi.fn(async () => attachment)) {
  const remove = vi.fn(), changed = vi.fn(), release = vi.fn();
  const store = createResidentImageStaging(changed, { stage, remove });
  const original = { image: { id: "browser-image", kind: "image", file: { size: 3 }, previewUrl: "blob:image" }, release } as unknown as ComposerDraftImageRegistration;
  return { store, image: store.wrap("target", original), original, stage, remove, changed, release };
}

it("uploads once across concurrent preparations and retry, holding native handoff until all leases release", async () => {
  const { store, image, original, stage, remove } = fixture();
  const [a, b] = await Promise.all([store.acquire([image]), store.acquire([image])]);
  expect(stage).toHaveBeenCalledTimes(1);
  expect(stage).toHaveBeenCalledWith(original, "target");
  expect(a.attachments[0].attachmentId).toBe(b.attachments[0].attachmentId);
  a.release(); a.release();
  expect(store.busy(image)).toBe(true);
  b.release();
  expect(store.busy(image)).toBe(false);
  const retry = await store.acquire([image]);
  expect(stage).toHaveBeenCalledTimes(1);
  image.release();
  expect(remove).not.toHaveBeenCalled();
  retry.release(); retry.release();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith(attachment);
});

it("keeps a removed image until an aborted delayed upload finishes, then removes its file", async () => {
  let finish!: (value: Attachment) => void;
  const { store, image, remove, release } = fixture(vi.fn(() => new Promise<Attachment>(resolve => { finish = resolve; })));
  const controller = new AbortController();
  const pending = store.acquire([image], controller.signal);
  await Promise.resolve();
  image.release(); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(remove).not.toHaveBeenCalled();
  expect(store.busy(image)).toBe(true);
  finish(attachment);
  await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  expect(release).toHaveBeenCalledTimes(1);
  expect(store.busy(image)).toBe(false);
});

it("retains successful staging after caller cancellation and delegates deletion after native transfer", async () => {
  const { store, image, remove, stage } = fixture();
  const controller = new AbortController();
  const pending = store.acquire([image], controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(store.busy(image)).toBe(false));
  const retry = await store.acquire([image]);
  retry.release(); store.transfer(image); image.release();
  expect(image.prepared).toEqual(attachment);
  expect(stage).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
  await expect(store.acquire([image])).rejects.toThrow("no longer available");
});

it("retries failed uploads and rejects invalid batches without leaking holds", async () => {
  const stage = vi.fn(async () => attachment).mockRejectedValueOnce(new Error("offline"));
  const { store, image, original } = fixture(stage);
  await expect(store.acquire([image])).rejects.toThrow("offline");
  expect(store.busy(image)).toBe(false);
  await expect(store.acquire([image, original])).rejects.toThrow("no longer available");
  expect(store.busy(image)).toBe(false);
  const retry = await store.acquire([image]);
  expect(stage).toHaveBeenCalledTimes(2);
  retry.release(); image.release();
});
