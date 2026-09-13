import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ComposerDraftImageRegistration } from "../triggers/contracts";
import { useComposerAttachments } from "../../useComposerAttachments";

const host = vi.hoisted(() => ({ remove: vi.fn(async () => {}) }));
vi.mock("@amiba/app-runtime/platform", () => ({ getPlatform: () => ({ agentAttachments: host }) }));

it("adopts prepared images synchronously without a new upload or session, preserving browser identity and native removal", async () => {
  const getSessionId = vi.fn(() => "target"), release = vi.fn();
  const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
  const registration = {
    image: { id: "browser-image", kind: "image", file, previewUrl: "blob:image" }, release,
    prepared: { uiId: "staged", attachmentId: "host-file", kind: "image", name: "a.png", mime: "image/png", size: 3, uploading: false },
  } as unknown as ComposerDraftImageRegistration;
  const { result } = renderHook(() => useComposerAttachments({ getSessionId }));
  await act(async () => { result.current.addDraftImages!([registration]); });
  expect(getSessionId).not.toHaveBeenCalled();
  expect(result.current.attachmentError).toBeNull();
  expect(result.current.attachments).toHaveLength(1);
  expect(result.current.attachments[0]).toMatchObject({ attachmentId: "host-file", uploading: false });
  expect(result.current.attachments[0].uiId).not.toBe("staged");
  expect(result.current.getDraftImages!()[0]).toBe(registration.image);
  await act(async () => { result.current.removeDraftImage!(registration.image.id); });
  expect(result.current.attachments).toEqual([]);
  expect(release).toHaveBeenCalledTimes(1);
  expect(host.remove).toHaveBeenCalledTimes(1);
});
