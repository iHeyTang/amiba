import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ComposerAttachment } from "@amiba/extension-sdk";
const fixture = vi.hoisted(() => ({ drafts: new Map<string, ComposerAttachment>(), uploads: {} as Record<string, any>, listeners: new Set<() => void>(), remove: vi.fn(async () => {}), retry: vi.fn() }));
vi.mock("@amiba/app-runtime/platform", () => ({ getPlatform: () => ({ agentAttachments: {
  drafts: (ids: string[]) => ids.flatMap(id => fixture.drafts.has(id) ? [fixture.drafts.get(id)!] : []),
  uploadState: () => fixture.uploads,
  subscribe: (fn: () => void) => { fixture.listeners.add(fn); return () => { fixture.listeners.delete(fn); }; },
  remove: fixture.remove, retry: fixture.retry,
} }) }));
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
import { useComposerAttachments } from "../../useComposerAttachments";
const chip = { uiId: "chip", attachmentId: "official", name: "notes.pdf", mime: "application/pdf", size: 3, kind: "pdf" as const };
beforeEach(() => { fixture.drafts.clear(); fixture.uploads = {}; fixture.listeners.clear(); vi.clearAllMocks(); });
it("resolves the original official draft ID without creating a second image registry entry", () => {
  const draft: ComposerAttachment = { id: "official" as never, kind: "file", file: new File(["pdf"], "notes.pdf") };
  fixture.drafts.set("official", draft);
  const register = vi.fn(); const { result } = renderHook(() => useComposerAttachments({ getSessionId: () => "s", registerDraftImage: register }));
  act(() => result.current.setAttachments([chip]));
  expect(result.current.getDraftImages!()).toEqual([draft]); expect(register).not.toHaveBeenCalled();
});
it("displays official upload progress and retries that same draft", () => {
  fixture.drafts.set("official", { id: "official" as never, kind: "file", file: new File(["pdf"], "notes.pdf") });
  const { result } = renderHook(() => useComposerAttachments({ getSessionId: () => "s" }));
  act(() => { result.current.setAttachments([chip]); fixture.uploads = { official: { status: "uploading", loaded: 1 } }; for (const fn of fixture.listeners) fn(); });
  expect(result.current.attachmentUploading).toBe(true);
  act(() => { fixture.uploads = { official: { status: "error", message: "offline" } }; for (const fn of fixture.listeners) fn(); });
  expect(result.current.fileUploads).toBe(fixture.uploads);
  result.current.retryFileUpload!("official"); expect(fixture.retry).toHaveBeenCalledWith("official");
});
it("does not reconstruct old IDs from a removed storage service", () => {
  const register = vi.fn(); const { result } = renderHook(() => useComposerAttachments({ getSessionId: () => "s", registerDraftImage: register }));
  act(() => result.current.setAttachments([{ ...chip, attachmentId: "att_old" }]));
  expect(result.current.getDraftImages!()).toEqual([]); expect(register).not.toHaveBeenCalled();
});
