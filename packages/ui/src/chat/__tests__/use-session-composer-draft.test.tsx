import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { StorageAdapter } from "@amiba/app-runtime/platform";
import { useSessionComposerDraft } from "../use-session-composer-draft";

const platform = vi.hoisted(() => ({ storage: undefined as unknown as StorageAdapter }));
vi.mock("@amiba/app-runtime/platform", () => ({ getPlatform: () => platform }));

beforeEach(() => {
  platform.storage = {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    watch: vi.fn(() => () => {}),
  };
});

it("restores the home draft after navigating away and remounting", () => {
  const first = renderHook(() => useSessionComposerDraft(null));
  act(() => first.result.current[1]("还没发出的内容"));
  const document = first.result.current[3].getDocument();
  first.unmount();

  const session = renderHook(() => useSessionComposerDraft("session"));
  act(() => session.result.current[1]("Session draft"));
  session.unmount();

  const home = renderHook(() => useSessionComposerDraft(undefined));
  expect(home.result.current[0]).toBe("还没发出的内容");
  expect(home.result.current[3].getDocument()).toBe(document);
  home.unmount();
});

it("keeps home and session drafts isolated when the active session changes", () => {
  const hook = renderHook(({ id }: { id: string | null }) => useSessionComposerDraft(id), {
    initialProps: { id: null as string | null },
  });
  act(() => hook.result.current[1]("Home draft"));
  hook.rerender({ id: "session" });
  expect(hook.result.current[0]).toBe("");
  act(() => hook.result.current[1]("Session draft"));
  hook.rerender({ id: null });
  expect(hook.result.current[0]).toBe("Home draft");
  hook.unmount();
});

it("does not restore a home draft after successful send or explicit clear", () => {
  for (const send of [true, false]) {
    const first = renderHook(() => useSessionComposerDraft(null));
    act(() => first.result.current[1]("Home draft"));
    act(() => {
      const source = first.result.current[3];
      if (send) expect(source.commitSend(source.getDocument())).toBe(true);
      else first.result.current[1]("");
    });
    first.unmount();
    const reopened = renderHook(() => useSessionComposerDraft(null));
    expect(reopened.result.current[0]).toBe("");
    reopened.unmount();
  }
});
