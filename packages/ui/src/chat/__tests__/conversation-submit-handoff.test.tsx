import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useConversationSubmitHandoff } from "../useConversationSubmitHandoff";

const args = { text: "hello", attachments: [{ attachmentId: "file-1" }] };
describe("conversation submit handoff", () => {
  it("resumes with the new render's session history and preserves attachments", async () => {
    const sent = vi.fn();
    const prepare = vi.fn(async () => "today");
    const { result } = renderHook(() => {
      const [activeId, setActiveId] = useState("yesterday");
      return useConversationSubmitHandoff({
        activeId, prepare, refresh: async () => {}, open: async (id) => setActiveId(id),
        run: async (payload: typeof args) => { sent(activeId, payload); },
      });
    });
    let sending!: Promise<boolean>;
    await act(async () => { sending = result.current(args); });
    await expect(sending).resolves.toBe(true);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith("today", args);
  });
  it("does not switch ordinary sessions or send them a second time", async () => {
    const open = vi.fn(), run = vi.fn();
    const { result } = renderHook(() => useConversationSubmitHandoff({ activeId: "ordinary", prepare: async id => id, refresh: async () => {}, open, run }));
    await expect(result.current(args)).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it("does not redirect a message after the user switches to another chat", async () => {
    let finish!: (id: string) => void;
    const prepare = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const open = vi.fn(), run = vi.fn();
    const { result, rerender } = renderHook(({ id }) => useConversationSubmitHandoff({ activeId: id, prepare, refresh: async () => {}, open, run }), { initialProps: { id: "yesterday" } });
    const sending = result.current(args);
    const rejected = expect(sending).rejects.toThrow("changed");
    rerender({ id: "another-chat" });
    finish("today");
    await rejected;
    expect(open).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects an unfinished handoff on unmount rather than leaving the send hanging", async () => {
    const open = vi.fn(async () => {});
    const { result, unmount } = renderHook(() => useConversationSubmitHandoff({ activeId: "old", prepare: async () => "new", refresh: async () => {}, open, run: async () => {} }));
    const sending = result.current(args);
    const rejected = expect(sending).rejects.toThrow("closed");
    await waitFor(() => expect(open).toHaveBeenCalled());
    unmount();
    await rejected;
  });
});
