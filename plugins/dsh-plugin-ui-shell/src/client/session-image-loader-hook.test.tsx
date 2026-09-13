// @vitest-environment jsdom
import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ImageAttachmentRef } from "@amiba/extension-sdk";
import { useSessionImageLoader } from "./session-image-loader";
afterEach(() => vi.unstubAllGlobals());
it("uses a fresh authorized cache after StrictMode replay and session replacement", async () => {
  const create = vi.fn().mockReturnValueOnce("blob:a").mockReturnValueOnce("blob:b");
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
  const image: ImageAttachmentRef = { attachmentId: "image" as ImageAttachmentRef["attachmentId"], mediaType: "image/png", bytes: 1, width: 1, height: 1 };
  const result = { ok: true as const, value: { attachment: image, data: new Uint8Array([1]) } };
  const a = { readAttachment: vi.fn(async () => result) };
  const b = { readAttachment: vi.fn(async () => result) };
  let current: ReturnType<typeof useSessionImageLoader>;
  function Probe({ session }: { session: typeof a }) { current = useSessionImageLoader(session); return null; }
  const view = render(<StrictMode><Probe session={a} /></StrictMode>);
  await waitFor(() => expect(current).toBeDefined());
  const previous = current!;
  await expect(previous(image)).resolves.toBe("blob:a");
  view.rerender(<StrictMode><Probe session={b} /></StrictMode>);
  await waitFor(() => { expect(current).toBeDefined(); expect(current).not.toBe(previous); });
  expect(revoke).toHaveBeenCalledWith("blob:a");
  expect(current!.peek(image)).toBeUndefined();
  await expect(previous(image)).rejects.toThrow("released");
  await expect(current!(image)).resolves.toBe("blob:b");
  expect(a.readAttachment).toHaveBeenCalledTimes(1);
  expect(b.readAttachment).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(revoke.mock.calls).toEqual([["blob:a"], ["blob:b"]]);
});
