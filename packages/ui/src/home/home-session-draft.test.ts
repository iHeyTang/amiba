import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { bindHomeComposerDraft, finishHomeComposerDraft, homeComposerDraft, sessionComposerDraft } from "../chat/composer-draft-store";
import { composerAttachmentDraft, moveComposerAttachmentDraft } from "../chat/composer-attachment-store";
import { useComposerAttachments } from "../chat/useComposerAttachments";
import { setPlatform, type StorageAdapter, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { beginHomeDraftHandoff } from "./home-draft-handoff";
import { usePendingPromptHandoff } from "../chat/usePendingPromptHandoff";
let storage: StorageAdapter;
beforeEach(() => {
  storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}), watch: vi.fn(() => () => {}) };
  setPlatform({ storage } as unknown as PlatformAdapter);
});
it("adopts pre-session edits into the same real-session source and restores after remount", () => {
  const source = homeComposerDraft(storage);
  source.set('typed while preparing');
  const document = source.getDocument();
  const attachments = composerAttachmentDraft(source);
  expect(bindHomeComposerDraft(storage, 'real')).toBe(source);
  expect(sessionComposerDraft(storage, 'real')).toBe(source);
  expect(sessionComposerDraft(storage, 'real').getDocument()).toBe(document);
  expect(homeComposerDraft(storage)).toBe(source);
  expect(composerAttachmentDraft(homeComposerDraft(storage))).toBe(attachments);
});
it("moves the ongoing Home draft when changing workspace without sharing it with the old session", () => {
  const source = bindHomeComposerDraft(storage, 'one'); source.set('move this draft');
  expect(bindHomeComposerDraft(storage, 'two')).toBe(source);
  expect(sessionComposerDraft(storage, 'two').getSnapshot()).toBe('move this draft');
  expect(sessionComposerDraft(storage, 'one').getSnapshot()).toBe('');
});
it("consumes submitted edits, retains newer Home edits, then persists ordinary conversation edits", async () => {
  const source = bindHomeComposerDraft(storage, 'real'); source.set('submitted');
  const submitted = source.getDocument();
  source.set('newer draft');
  const next = finishHomeComposerDraft(storage, 'real', source, submitted);
  expect(homeComposerDraft(storage)).toBe(next);
  expect(next.getSnapshot()).toBe('newer draft');
  expect(sessionComposerDraft(storage, 'real')).toBe(source);
  expect(source.getSnapshot()).toBe('');
  source.set('ordinary conversation draft');
  await waitFor(() => expect(storage.set).toHaveBeenCalledWith(expect.objectContaining({ 'amiba.composer.draft.real': expect.objectContaining({ text: 'ordinary conversation draft' }) })));
  expect(next.getSnapshot()).toBe('newer draft');
});
it("keeps leftover uploads with the next Home and reacquires the receiver attachment owner", () => {
  const source = bindHomeComposerDraft(storage, 'real');
  const hook = renderHook(({ id }) => useComposerAttachments({ draftScope: source, draftKey: id, getSessionId: () => id }), { initialProps: { id: '' } });
  act(() => hook.result.current.setAttachments([{ uiId: 'new-upload', name: 'new', size: 1, mime: 'text/plain', kind: 'text', uploading: true }]));
  const uploading = composerAttachmentDraft(source);
  const next = finishHomeComposerDraft(storage, 'real', source, source.getDocument());
  moveComposerAttachmentDraft(source, next);
  hook.rerender({ id: 'real' });
  expect(hook.result.current.attachments).toEqual([]);
  expect(composerAttachmentDraft(next)).toBe(uploading);
  expect(uploading.getSnapshot().attachments[0].uiId).toBe('new-upload');
});
it("does not open or populate the receiver until Home has consumed the original draft", async () => {
  const release = beginHomeDraftHandoff('leased');
  const drain = vi.fn().mockResolvedValueOnce({ sessionId: 'leased', text: 'submitted' }).mockResolvedValue(null);
  const open = vi.fn(async () => {}), receive = vi.fn(async () => {});
  const { rerender } = renderHook(({ activeId }) => usePendingPromptHandoff({ activeId, drain, tick: 0, open, receive, onError: vi.fn() }), { initialProps: { activeId: '' } });
  await act(async () => {});
  expect(open).not.toHaveBeenCalled();
  await act(async () => { release(); });
  expect(open).toHaveBeenCalledWith('leased');
  rerender({ activeId: 'leased' });
  await waitFor(() => expect(receive).toHaveBeenCalledOnce());
});
it("does not clear a later workspace draft when an earlier handoff completes", () => {
  const source = bindHomeComposerDraft(storage, 'old'); source.set('submitted');
  const submitted = source.getDocument();
  bindHomeComposerDraft(storage, 'new'); source.set('new workspace draft');
  finishHomeComposerDraft(storage, 'old', source, submitted);
  expect(sessionComposerDraft(storage, 'new').getSnapshot()).toBe('new workspace draft');
  expect(homeComposerDraft(storage)).toBe(source);
});
