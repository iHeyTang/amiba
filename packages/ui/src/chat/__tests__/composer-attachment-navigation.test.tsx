import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), remove: vi.fn() }));
vi.mock("@amiba/app-runtime/platform", () => ({ getPlatform: () => ({ agentAttachments: { remove: mocks.remove } }) }));
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("@amiba/app-runtime/core", async importOriginal => ({
  ...await importOriginal<typeof import("@amiba/app-runtime/core")>(),
  readFileAsAttachment: mocks.read,
}));
import { useComposerAttachments } from "../useComposerAttachments";
const file = new File(["hello"], "hello.txt", { type: "text/plain" });
const attachment = { uiId: "a", attachmentId: "host-a", name: "hello.txt", mime: "text/plain", size: 5, kind: "text" as const };
beforeEach(() => vi.clearAllMocks());

it("keeps attachments isolated by conversation, including remounts and old setters", () => {
  const one = {}, two = {};
  const hook = renderHook(({ scope }) => useComposerAttachments({ draftScope: scope, getSessionId: () => "session" }), { initialProps: { scope: one } });
  act(() => hook.result.current.setAttachments([attachment]));
  const setOne = hook.result.current.setAttachments;
  hook.rerender({ scope: two });
  expect(hook.result.current.attachments).toEqual([]);
  act(() => setOne(previous => [...previous, { ...attachment, uiId: "b" }]));
  expect(hook.result.current.attachments).toEqual([]);
  hook.unmount();
  const restored = renderHook(() => useComposerAttachments({ draftScope: one, getSessionId: () => "session" }));
  expect(restored.result.current.attachments.map(a => a.uiId)).toEqual(["a", "b"]);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("finishes an upload for its original draft after navigation and unmount", async () => {
  const one = {}, two = {};
  let finish!: (value: unknown) => void;
  mocks.read.mockImplementation((_file, { uiId }) => new Promise(resolve => {
    finish = () => resolve({ ok: true, attachment: { ...attachment, uiId } });
  }));
  const hook = renderHook(({ scope }) => useComposerAttachments({ draftScope: scope, getSessionId: () => "original-session" }), { initialProps: { scope: one } });
  let upload!: Promise<void>;
  await act(async () => { upload = hook.result.current.addFiles([file]); });
  expect(hook.result.current.attachmentBusy).toBe(true);
  hook.rerender({ scope: two });
  expect(hook.result.current.attachmentBusy).toBe(false);
  expect(hook.result.current.attachments).toEqual([]);
  hook.unmount();
  await act(async () => { finish(undefined); await upload; });
  const restored = renderHook(() => useComposerAttachments({ draftScope: one, getSessionId: () => "original-session" }));
  expect(restored.result.current.attachments[0].attachmentId).toBe("host-a");
  expect(restored.result.current.attachmentBusy).toBe(false);
  expect(mocks.read).toHaveBeenCalledWith(file, expect.objectContaining({ sessionId: "original-session" }));
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("removing a pending upload cannot resurrect it on completion", async () => {
  let finish!: () => void;
  mocks.read.mockImplementation((_file, { uiId }) => new Promise(resolve => {
    finish = () => resolve({ ok: true, attachment: { ...attachment, uiId } });
  }));
  const scope = {};
  const hook = renderHook(() => useComposerAttachments({ draftScope: scope, getSessionId: () => "s" }));
  let upload!: Promise<void>;
  await act(async () => { upload = hook.result.current.addFiles([file]); });
  act(() => hook.result.current.removeAttachment(hook.result.current.attachments[0].uiId));
  await act(async () => { finish(); await upload; });
  expect(hook.result.current.attachments).toEqual([]);
  expect(mocks.remove).toHaveBeenCalledWith("host-a");
});
