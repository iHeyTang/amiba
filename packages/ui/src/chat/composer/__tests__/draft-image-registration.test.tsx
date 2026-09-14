import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComposerAttachment } from "@amiba/extension-sdk";
const storage = vi.hoisted(() => ({ read: vi.fn(), remove: vi.fn() }));
vi.mock("@amiba/app-runtime/core", () => ({
  classify: (_name: string, mime: string) => mime.startsWith("image/") ? "image" : "text",
  readFileAsAttachment: storage.read,
  deleteAttachmentFile: storage.remove,
  isAttachmentReadOk: (value: { attachment?: unknown }) => !!value.attachment,
}));
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
import { useComposerAttachments } from "../../useComposerAttachments";

function registry() {
  const release = vi.fn();
  const registerDraftImage = vi.fn((file: File) => ({
    image: { kind: "image", id: "browser-image" as ComposerAttachment["id"], file, previewUrl: "blob:original" } as ComposerAttachment,
    release,
  }));
  return { registerDraftImage, release };
}
function successfulRead() {
  storage.read.mockImplementation(async (file: File, { uiId }: { uiId: string }) => ({
    attachment: { uiId, attachmentId: "host-staging", name: file.name, mime: file.type, size: file.size, kind: "image" },
  }));
}

describe("native attachment registration in the official browser registry", () => {
  it("keeps the original File and distinct identities, and releases on native removal", async () => {
    successfulRead();
    const registration = registry();
    const { result, unmount } = renderHook(() => useComposerAttachments({ getSessionId: () => "session", ...registration }));
    const file = new File(["original"], "image.png", { type: "image/png" });
    await act(() => result.current.addFiles([file]));
    expect(result.current.draftImages?.[0].file).toBe(file);
    expect(result.current.draftImages?.[0].id).toBe("browser-image");
    expect(result.current.attachments[0].attachmentId).toBe("host-staging");
    act(() => result.current.removeAttachment(result.current.attachments[0].uiId));
    expect(result.current.draftImages).toEqual([]);
    expect(registration.release).toHaveBeenCalledTimes(1);
    unmount();
    expect(registration.release).toHaveBeenCalledTimes(1);
  });

  it("releases browser resources on upload failure", async () => {
    storage.read.mockResolvedValue({ name: "image.png", error: "failed" });
    const registration = registry();
    const { result } = renderHook(() => useComposerAttachments({ getSessionId: () => "session", ...registration }));
    await act(() => result.current.addFiles([new File(["bytes"], "image.png", { type: "image/png" })]));
    expect(result.current.attachments).toEqual([]);
    expect(registration.release).toHaveBeenCalledTimes(1);
  });

  it("releases on direct state clearing and unmount, without changing native format support", async () => {
    successfulRead();
    const registration = registry();
    const { result, unmount } = renderHook(() => useComposerAttachments({ getSessionId: () => "session", ...registration }));
    const file = new File(["bytes"], "image.png", { type: "image/png" });
    await act(() => result.current.addFiles([file]));
    act(() => result.current.setAttachments([]));
    expect(registration.release).toHaveBeenCalledTimes(1);
    await act(() => result.current.addFiles([file]));
    unmount();
    expect(registration.release).toHaveBeenCalledTimes(2);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unsupported = renderHook(() => useComposerAttachments({ getSessionId: () => "session", registerDraftImage: () => { throw new Error("unsupported MIME"); } }));
    await act(() => unsupported.result.current.addFiles([file]));
    expect(unsupported.result.current.attachments[0].attachmentId).toBe("host-staging");
    expect(unsupported.result.current.draftImages).toEqual([]);
    warn.mockRestore();
  });

  it("does not register after unmount while session lookup is pending", async () => {
    successfulRead();
    const registration = registry();
    let resolve!: (id: string) => void;
    const session = new Promise<string>(done => { resolve = done; });
    const { result, unmount } = renderHook(() => useComposerAttachments({ getSessionId: () => session, ...registration }));
    let upload!: Promise<void>;
    act(() => { upload = result.current.addFiles([new File(["bytes"], "image.png", { type: "image/png" })]); });
    unmount();
    await act(async () => { resolve("session"); await upload; });
    expect(registration.registerDraftImage).not.toHaveBeenCalled();
  });

  it("releases when removed during upload and deletes the late staged file", async () => {
    let resolve!: (value: unknown) => void;
    let uiId = "";
    storage.read.mockImplementation((_file: File, options: { uiId: string }) => {
      uiId = options.uiId;
      return new Promise(done => { resolve = done; });
    });
    storage.remove.mockClear();
    const registration = registry();
    const { result } = renderHook(() => useComposerAttachments({ getSessionId: () => "session", ...registration }));
    let upload!: Promise<void>;
    act(() => { upload = result.current.addFiles([new File(["bytes"], "image.png", { type: "image/png" })]); });
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    act(() => result.current.removeAttachment(uiId));
    expect(registration.release).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ attachment: { uiId, attachmentId: "late-host" } }); await upload; });
    expect(storage.remove).toHaveBeenCalledWith({ uiId, attachmentId: "late-host" });
    expect(registration.release).toHaveBeenCalledTimes(1);
  });
});

describe("extension-created draft images", () => {
  it("stages the supplied original File without creating a second browser identity", async () => {
    successfulRead();
    const registration = registry();
    const original = new File(["original"], "extension.png", { type: "image/png" });
    const supplied = registration.registerDraftImage(original);
    registration.registerDraftImage.mockClear();
    const { result } = renderHook(() => useComposerAttachments({ getSessionId: () => "session", ...registration }));
    act(() => {
      expect(result.current.canAddDraftImages!()).toBe(true);
      result.current.addDraftImages!([supplied]);
      expect(result.current.canAddDraftImages!()).toBe(false);
    });
    await waitFor(() => expect(result.current.attachmentBusy).toBe(false));
    expect(registration.registerDraftImage).not.toHaveBeenCalled();
    expect(result.current.draftImages).toEqual([supplied.image]);
    expect(storage.read).toHaveBeenCalledWith(original, expect.objectContaining({ sessionId: "session" }));
    act(() => result.current.removeDraftImage!(supplied.image.id));
    expect(result.current.attachments).toEqual([]);
    expect(registration.release).toHaveBeenCalledTimes(1);
  });

  it("can remove a supplied image immediately while session lookup is pending", async () => {
    successfulRead();
    const supplied = registry().registerDraftImage(new File(["bytes"], "extension.png", { type: "image/png" }));
    let resolve!: (id: string) => void;
    const session = new Promise<string>(done => { resolve = done; });
    const { result } = renderHook(() => useComposerAttachments({ getSessionId: () => session }));
    act(() => {
      result.current.addDraftImages!([supplied]);
      result.current.removeDraftImage!(supplied.image.id);
    });
    expect(result.current.attachments).toEqual([]);
    expect(supplied.release).toHaveBeenCalledTimes(1);
    await act(async () => { resolve("session"); });
    await waitFor(() => expect(result.current.attachmentBusy).toBe(false));
    expect(result.current.attachments).toEqual([]);
    expect(supplied.release).toHaveBeenCalledTimes(1);
  });

  it("releases supplied images if session lookup fails", async () => {
    const supplied = registry().registerDraftImage(new File(["bytes"], "extension.png", { type: "image/png" }));
    const { result } = renderHook(() => useComposerAttachments({ getSessionId: async () => { throw new Error("no session"); } }));
    act(() => result.current.addDraftImages!([supplied]));
    await waitFor(() => expect(result.current.attachmentBusy).toBe(false));
    expect(result.current.attachments).toEqual([]);
    expect(supplied.release).toHaveBeenCalledTimes(1);
  });
});

it("publishes synchronous stable image snapshots and prunes only registered draft images", async () => {
  successfulRead();
  const first = registry().registerDraftImage(new File(["bytes"], "drop.png", { type: "image/png" }));
  const second = { image: { ...first.image, id: "keep-image" as ComposerAttachment["id"] }, release: vi.fn() };
  const { result } = renderHook(() => useComposerAttachments({ getSessionId: () => "session" }));
  const observations: ComposerAttachment[][] = [];
  const off = result.current.subscribeDraftImages!(() => observations.push([...result.current.getDraftImages!()]));
  const nativeFile = { uiId: "text-file", attachmentId: "text-host", kind: "text" as const, name: "notes.txt", mime: "text/plain", size: 3 };
  let before!: readonly ComposerAttachment[];
  act(() => {
    result.current.setAttachments([nativeFile]);
    result.current.addDraftImages!([first, second]);
    before = result.current.getDraftImages!();
    expect(before).toEqual([first.image, second.image]);
    expect(result.current.getDraftImages!()).toBe(before);
    expect(Object.isFrozen(before)).toBe(true);
    // Maintenance pruning must work even while upload admission is busy.
    expect(result.current.canAddDraftImages!()).toBe(false);
    result.current.pruneDraftImages!([second.image.id]);
    expect(result.current.getDraftImages!()).toEqual([second.image]);
  });
  expect(result.current.attachments.some(a => a.uiId === nativeFile.uiId)).toBe(true);
  expect(before).toEqual([first.image, second.image]);
  expect(first.release).toHaveBeenCalledTimes(1);
  expect(second.release).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.attachmentBusy).toBe(false));
  expect(observations).toEqual([[first.image, second.image], [second.image]]);
  const stable = result.current.getDraftImages!();
  act(() => result.current.pruneDraftImages!([second.image.id]));
  expect(result.current.getDraftImages!()).toBe(stable);
  off();
  off();
  act(() => result.current.pruneDraftImages!([]));
  expect(result.current.attachments).toEqual([nativeFile]);
  expect(second.release).toHaveBeenCalledTimes(1);
  expect(observations).toHaveLength(2);
});

it("does not resurrect a late upload after its input hook is unmounted", async () => {
  let finish!: (value: unknown) => void;
  let uiId = "";
  storage.read.mockImplementation((_file: File, opts: { uiId: string }) => {
    uiId = opts.uiId;
    return new Promise(resolve => { finish = resolve; });
  });
  storage.remove.mockClear();
  const supplied = registry().registerDraftImage(new File(["bytes"], "pending.png", { type: "image/png" }));
  const { result, unmount } = renderHook(() => useComposerAttachments({ getSessionId: () => "session" }));
  act(() => result.current.addDraftImages!([supplied]));
  await waitFor(() => expect(finish).toBeDefined());
  unmount();
  await act(async () => finish({ attachment: { uiId, attachmentId: "late-upload" } }));
  expect(supplied.release).toHaveBeenCalledTimes(1);
  expect(storage.remove).toHaveBeenCalledWith({ uiId, attachmentId: "late-upload" });
});
