import { StrictMode, useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { usePendingPromptHandoff } from "../usePendingPromptHandoff";

it.each(['old-chat', ''])("opens the addressed real session before delivering from %s", async initial => {
  const payload = { sessionId: 'prepared', text: 'hello', attachments: [{ uiId: 'a', attachmentId: 'file', name: 'a', mime: 'text/plain', size: 1, kind: 'text' as const }] };
  const drain = vi.fn().mockResolvedValueOnce(payload).mockResolvedValue(null);
  const received = vi.fn(), open = vi.fn(), onError = vi.fn();
  renderHook(() => {
    const [activeId, setActiveId] = useState(initial);
    usePendingPromptHandoff({ activeId, drain, tick: 0, onError,
      open: async id => { open(id); setActiveId(id); },
      receive: async data => { received(activeId, data); },
    });
  }, { wrapper: StrictMode });
  await waitFor(() => expect(received).toHaveBeenCalledOnce());
  expect(received).toHaveBeenCalledWith('prepared', payload);
  expect(open).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled();
});
it("keeps the prompt after an open failure and delivers on a later successful navigation", async () => {
  const payload = { sessionId: 'prepared', text: 'hello' };
  const drain = vi.fn().mockResolvedValueOnce(payload).mockResolvedValue(null);
  const receive = vi.fn(async () => {}), onError = vi.fn();
  const open = vi.fn().mockRejectedValue(new Error('offline'));
  const { rerender } = renderHook(({ activeId }) => usePendingPromptHandoff({ activeId, drain, tick: 0, open, receive, onError }), { initialProps: { activeId: 'old' } });
  await waitFor(() => expect(onError).toHaveBeenCalled());
  expect(receive).not.toHaveBeenCalled();
  rerender({ activeId: 'prepared' });
  await waitFor(() => expect(receive).toHaveBeenCalledWith(payload));
});
it("serializes destructive drains while navigation changes", async () => {
  let finish!: () => void;
  const drain = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(null); })).mockResolvedValue(null);
  const { rerender } = renderHook(({ activeId }) => usePendingPromptHandoff({ activeId, drain, tick: 0, open: vi.fn(), receive: vi.fn(), onError: vi.fn() }), { initialProps: { activeId: 'one' } });
  await waitFor(() => expect(drain).toHaveBeenCalledOnce());
  rerender({ activeId: 'two' }); expect(drain).toHaveBeenCalledOnce();
  await act(async () => { finish(); });
  await waitFor(() => expect(drain).toHaveBeenCalledTimes(2));
});

it("retains a claimed home prompt while slow session loading hides the conversation", async () => {
  const { render, screen } = await import("@testing-library/react");
  const { SessionLoadingBoundary } = await import("../SessionLoadingBoundary");
  const payload = { sessionId: "prepared", text: "first message" };
  const drain = vi.fn().mockResolvedValueOnce(payload).mockResolvedValue(null);
  const receive = vi.fn(async () => {});
  const open = vi.fn(async () => {});
  function Conversation({ activeId }: { activeId: string }) {
    usePendingPromptHandoff({ activeId, drain, tick: 0, open, receive, onError: vi.fn() });
    return <div>conversation</div>;
  }
  const page = (activeId: string, loading: boolean) => <SessionLoadingBoundary loading={loading} fallback={<div>loading</div>}><Conversation activeId={activeId} /></SessionLoadingBoundary>;
  const view = render(page("", false));
  await waitFor(() => expect(open).toHaveBeenCalledWith("prepared"));
  view.rerender(page("", true));
  expect(screen.getByText("conversation").parentElement?.hidden).toBe(true);
  expect(receive).not.toHaveBeenCalled();
  view.rerender(page("prepared", false));
  await waitFor(() => expect(receive).toHaveBeenCalledWith(payload));
  expect(receive).toHaveBeenCalledTimes(1);
});
