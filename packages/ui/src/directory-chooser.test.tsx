// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  DirectoryChooserContext,
  useDirectoryChooser,
} from "./directory-chooser";
const state = vi.hoisted(() => ({
  native: undefined as undefined | ReturnType<typeof vi.fn>,
}));
vi.mock("@amiba/app-runtime/platform", () => ({
  getPlatform: () => ({ workspaces: { chooseDirectory: state.native } }),
}));
afterEach(() => {
  cleanup();
  state.native = undefined;
});
it("preserves native start path and performs the caller's mutation only after selection", async () => {
  state.native = vi
    .fn()
    .mockResolvedValueOnce("/selected")
    .mockResolvedValueOnce(null);
  const adopt = vi.fn();
  const { result } = renderHook(() => useDirectoryChooser("home"));
  await act(async () => {
    expect(await result.current!("/start", adopt)).toBe("/selected");
  });
  expect(state.native).toHaveBeenCalledWith("/start");
  expect(adopt).toHaveBeenCalledWith("/selected");
  await act(async () => {
    expect(await result.current!("/start", adopt)).toBeNull();
  });
  expect(adopt).toHaveBeenCalledTimes(1);
});
it("adds no chooser without a native or contributed implementation", () => {
  expect(
    renderHook(() => useDirectoryChooser("workspace")).result.current,
  ).toBeUndefined();
});
it("uses the matching extension surface and restores native fallback after removal", async () => {
  state.native = vi.fn().mockResolvedValue("/native");
  const extension = vi.fn(async (_start, adopt) => {
    await adopt("/plugin");
    return "/plugin";
  });
  const adopt = vi.fn();
  let installed = true;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DirectoryChooserContext.Provider
      value={installed ? { home: extension } : {}}
    >
      {children}
    </DirectoryChooserContext.Provider>
  );
  const home = renderHook(() => useDirectoryChooser("home"), { wrapper });
  const workspace = renderHook(() => useDirectoryChooser("workspace"), {
    wrapper,
  });
  await home.result.current!("/start", adopt);
  expect(adopt).toHaveBeenCalledWith("/plugin");
  expect(state.native).not.toHaveBeenCalled();
  await workspace.result.current!("/other", adopt);
  expect(state.native).toHaveBeenCalledWith("/other");
  installed = false;
  home.rerender();
  await home.result.current!("/restored", adopt);
  expect(state.native).toHaveBeenCalledWith("/restored");
});
it("preserves adoption failures for the existing error surface", async () => {
  state.native = vi.fn().mockResolvedValue("/selected");
  const { result } = renderHook(() => useDirectoryChooser("workspace"));
  await expect(
    result.current!(undefined, async () => {
      throw new Error("project rejected");
    }),
  ).rejects.toThrow("project rejected");
});
