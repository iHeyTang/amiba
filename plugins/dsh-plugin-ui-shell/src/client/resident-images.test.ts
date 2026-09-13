import { expect, it, vi } from "vitest";
import type { ComposerAttachment } from "@amiba/extension-sdk";
import type { ComposerDraftImageRegistration } from "@amiba/ui";
import { createComposerDraftSource } from "../../../../packages/ui/src/chat/composer-draft-store";
import { createInputTriggerBridge } from "./input-trigger-bridge.js";

function fixture() {
  const first = { kind: "image", id: "first", file: { name: "first.png" }, previewUrl: "blob:first" } as ComposerAttachment;
  const second = { kind: "image", id: "second", file: { name: "second.png" }, previewUrl: "blob:second" } as ComposerAttachment;
  const images = new Map([first, second].map(image => [image.id, image]));
  const release = vi.fn((id: ComposerAttachment["id"]) => { images.delete(id); });
  const registry = { createDraftImages: () => [], draftImages: (ids: readonly ComposerAttachment["id"][]) => ids.flatMap(id => images.has(id) ? [images.get(id)!] : []), releaseDraftImage: release };
  const bridge = createInputTriggerBridge({
    residentDraft: () => createComposerDraftSource(),
    images: () => registry,
    scopeOf: () => undefined, inputTriggers: () => undefined, commandUi: () => undefined, subscribeSessions: () => () => {},
  });
  const bind = (id: string, mode: "one-shot" | "continuable" = "continuable") => bridge.bindInputSession(id, {
    getSnapshot: () => ({ queue: [], subagent: { address: { mode } } }), subscribe: () => () => {},
  });
  return { bridge, bind, first, second, release };
}

it("keeps addressed browser objects offscreen, rejects unknown batches and releases only removed owners", () => {
  const { bridge, bind, first, second, release } = fixture();
  const offA = bind("a"), offB = bind("b");
  bind("readonly", "one-shot");
  expect(bridge.addInputImages("missing", [first.id])).toBe(false);
  expect(bridge.addInputImages("readonly", [first.id])).toBe(false);
  expect(bridge.addInputImages("a", [first.id, "unknown" as never])).toBe(false);
  expect(release).not.toHaveBeenCalled();
  expect(bridge.addInputImages("a", [first.id, second.id])).toBe(true);
  expect(bridge.addInputImages("b", [first.id])).toBe(true);
  expect(bridge.inputImagesFor("a")).toEqual([first, second]);
  expect(bridge.inputImagesFor("a")![0]).toBe(first);
  expect(bridge.inputStateSource("a").getSnapshot()!.imageIds).toEqual([first.id, second.id]);
  bridge.removeInputImage("a", first.id);
  expect(release).not.toHaveBeenCalled();
  bridge.pruneInputImages("a", []);
  expect(release).toHaveBeenCalledWith(second.id);
  offA(); offB(); offB();
  expect(release.mock.calls).toEqual([[second.id], [first.id]]);
});

it("transfers only after native readiness, without a missing or duplicated image snapshot", async () => {
  const { bridge, bind, first, release } = fixture();
  const offSession = bind("a");
  bridge.addInputImages("a", [first.id]);
  let ready = false;
  let availability: (() => void) | undefined, notify: (() => void) | undefined;
  const received: ComposerDraftImageRegistration[] = [];
  const add = vi.fn((images: readonly ComposerDraftImageRegistration[]) => { received.push(...images); notify?.(); });
  const observed: unknown[] = [];
  const offRead = bridge.inputImagesSource("a").subscribe(() => observed.push(bridge.inputImagesFor("a")));
  const off = bridge.bindImages!("a", {
    getImages: () => received.map(item => item.image), canAdd: () => ready, addImages: add, removeImage: () => {},
    subscribeImages(listener) { notify = listener; return () => { notify = undefined; }; },
    subscribeAvailability(listener) { availability = listener; return () => { availability = undefined; }; },
  });
  await Promise.resolve();
  expect(add).not.toHaveBeenCalled();
  expect(bridge.inputImagesFor("a")).toEqual([first]);
  // A mounted owner's refusal must not create a second resident addition.
  expect(bridge.addInputImages("a", [first.id])).toBe(false);
  ready = true; availability!(); availability!();
  expect(add).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(add).toHaveBeenCalledTimes(1);
  expect(received[0].image.file).toBe(first.file);
  expect(observed.every(snapshot => Array.isArray(snapshot) && snapshot.length === 1 && snapshot[0] === first)).toBe(true);
  offRead(); off(); offSession();
  expect(release).not.toHaveBeenCalled(); // Original native uploader now owns it.
  received[0].release();
  expect(release).toHaveBeenCalledTimes(1);
  expect(availability).toBeUndefined();
});

it("ignores stale transfer tasks and final session disposal releases undelivered images", async () => {
  const { bridge, bind, first, release } = fixture();
  const offSession = bind("a");
  bridge.addInputImages("a", [first.id]);
  const oldAdd = vi.fn(), nextAdd = vi.fn();
  const old = bridge.bindImages!("a", { getImages: () => [], canAdd: () => true, addImages: oldAdd, removeImage: () => {} });
  const next = bridge.bindImages!("a", { getImages: () => [], canAdd: () => false, addImages: nextAdd, removeImage: () => {} });
  old();
  await Promise.resolve();
  expect(oldAdd).not.toHaveBeenCalled();
  expect(nextAdd).not.toHaveBeenCalled();
  expect(bridge.inputImagesFor("a")).toEqual([first]);
  offSession(); next();
  await Promise.resolve();
  expect(release).toHaveBeenCalledTimes(1);
  expect(bridge.inputImagesFor("a")).toBeUndefined();
});
