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
