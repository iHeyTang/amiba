// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackgroundFrame } from "./BackgroundFrame.js";
import { DEFAULT_BACKGROUND } from "../../background/model.js";
import type { BackgroundController } from "./controller.js";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ language: "en" }) }));
let pause: ReturnType<typeof vi.fn>, play: ReturnType<typeof vi.fn>;
let reduced = false,
  mediaChange: (() => void) | undefined;
beforeEach(() => {
  reduced = false;
  Object.defineProperty(document, "hidden", {
    value: false,
    configurable: true,
  });
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, fn: () => void) => {
      mediaChange = fn;
    },
    removeEventListener: vi.fn(),
  }));
  URL.createObjectURL = vi.fn(() => "blob:fixture");
  URL.revokeObjectURL = vi.fn();
  pause = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = pause;
  HTMLMediaElement.prototype.play = play;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  let state = {
    snapshot: {
      revision: 1,
      config: {
        ...DEFAULT_BACKGROUND,
        enabled: true,
        assetId: "a".repeat(64) + ".mp4",
      },
    },
    ready: true,
    error: "",
  };
  const listeners = new Set<() => void>();
  const controller = {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    loadAsset: vi.fn().mockResolvedValue(new Blob(["video"])),
    configure: vi.fn(),
  } as unknown as BackgroundController;
  return {
    controller,
    update: (patch: object) => {
      state = {
        ...state,
        snapshot: {
          revision: state.snapshot.revision + 1,
          config: { ...state.snapshot.config, ...patch },
        },
      };
      listeners.forEach((fn) => fn());
    },
  };
}
it("keeps default surfaces until decoded, loops muted, pauses hidden/reduced and releases media on disable", async () => {
  const f = fixture();
  const view = render(
    <BackgroundFrame controller={f.controller}>
      <main>Chat</main>
    </BackgroundFrame>,
  );
  await waitFor(() =>
    expect(view.container.querySelector("video")).toBeTruthy(),
  );
  const video = view.container.querySelector("video")!;
  expect(
    view.container.firstElementChild?.hasAttribute("data-background-active"),
  ).toBe(false);
  fireEvent.loadedData(video);
  expect(
    view.container.firstElementChild?.getAttribute("data-background-active"),
  ).toBe("true");
  expect(video.loop).toBe(true);
  expect(video.muted).toBe(true);
  expect(play).toHaveBeenCalled();
  act(() => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(pause).toHaveBeenCalled();
  const count = play.mock.calls.length;
  act(() => {
    reduced = true;
    mediaChange?.();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(play.mock.calls.length).toBe(count);
  act(() => f.update({ enabled: false }));
  expect(view.container.querySelector("video")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture");
});
it("restores default surfaces on media decode failure without changing saved config", async () => {
  const f = fixture();
  const view = render(
    <BackgroundFrame controller={f.controller}>Chat</BackgroundFrame>,
  );
  await waitFor(() =>
    expect(view.container.querySelector("video")).toBeTruthy(),
  );
  fireEvent.loadedData(view.container.querySelector("video")!);
  fireEvent.error(view.container.querySelector("video")!);
  expect(
    view.container.firstElementChild?.hasAttribute("data-background-active"),
  ).toBe(false);
  expect(view.getByRole("status").textContent).toContain(
    "could not be decoded",
  );
  expect(f.controller.configure).not.toHaveBeenCalled();
});

it("leaves the standalone desktop pet window transparent and never loads background media", () => {
  window.history.replaceState({}, "", "?desktopPet=1");
  try {
    const f = fixture();
    const view = render(
      <BackgroundFrame controller={f.controller}>
        <div data-pet>Pet</div>
      </BackgroundFrame>,
    );
    expect(view.container.firstElementChild?.hasAttribute("data-pet")).toBe(
      true,
    );
    expect(view.container.querySelector(".amiba-background-frame")).toBeNull();
    expect(f.controller.loadAsset).not.toHaveBeenCalled();
  } finally {
    window.history.replaceState({}, "", "/");
  }
});
