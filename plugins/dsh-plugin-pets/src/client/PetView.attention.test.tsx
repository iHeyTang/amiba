// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PetView } from "./PetView.js";
import type { DesktopPetBridge } from "@amiba/app-runtime/platform";
import type { PetConfig } from "@mofli/core";

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("../model.js", () => ({
  registry: {
    create: () => ({
      engine: { dimension: "2d", rig: { parameters: {} }, handle },
      sample: () => ({}),
    }),
  },
}));
vi.mock("./visible-svg-bounds.js", () => ({ visibleSvgBounds: () => null }));
vi.mock("@mofli/core/browser", () => ({
  createSvgRenderer: (host: HTMLElement) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    host.append(svg);
    return {
      svg,
      render() {},
      destroy() {
        svg.remove();
      },
      hitTest: () => ({ region: "body" }),
    };
  },
}));
vi.mock("../mofli-capabilities.generated.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../mofli-capabilities.generated.js")>(),
  createSpatialRenderer: vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
let frame: FrameRequestCallback;
beforeEach(() => {
  handle.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

for (const source of ["surface", "desktop", "local"] as const) {
  it(`${source} pointer cannot override work, and idle resumes with the current target`, () => {
    let phase = "idle";
    let point = { x: 0.8, y: 0.2 };
    let changed = () => {};
    let moved = () => {};
    let nativePointer: (p: { x: number; y: number }) => void = () => {};
    const activity = {
      getSnapshot: () => ({ phase, revision: 1 }),
      subscribe: (cb: () => void) => {
        changed = cb;
        return () => {};
      },
    };
    const interaction = {
      getSnapshot: () => ({ pointer: point, input: { active: false } }),
      subscribe: (cb: () => void) => {
        moved = cb;
        return () => {};
      },
    };
    const desktop = {
      menu() {},
      api: {
        onPointer: (cb: typeof nativePointer) => {
          nativePointer = cb;
          return () => {};
        },
        setVisualBounds: vi.fn(),
        setIgnoreMouse: vi.fn(),
      } as unknown as DesktopPetBridge,
    };
    act(() =>
      root.render(
        <PetView
          config={{} as PetConfig}
          name="Pet"
          activity={activity as never}
          interaction={
            source === "surface" ? (interaction as never) : undefined
          }
          desktop={source === "desktop" ? desktop : undefined}
        />,
      ),
    );
    const move = () =>
      act(() => {
        if (source === "surface") moved();
        else if (source === "desktop") nativePointer(point);
        else
          host
            .querySelector("svg")!
            .dispatchEvent(
              new MouseEvent("pointermove", { clientX: 90, clientY: 60 }),
            );
      });
    move();
    expect(
      handle.mock.calls.some(
        ([event]) => event.type === "look" && event.value.x !== 0,
      ),
    ).toBe(true);
    for (const working of ["loading", "thinking", "responding", "tooling"]) {
      act(() => {
        phase = working;
        changed();
      });
      expect(host.querySelector("svg")!.dataset.companionFollowingPointer).toBe(
        "false",
      );
      handle.mockClear();
      point = { x: -0.6, y: -0.3 };
      move();
      expect(
        handle.mock.calls.filter(([event]) => event.type === "look"),
      ).toEqual([]);
    }
    act(() => {
      phase = "idle";
      changed();
    });
    expect(host.querySelector("svg")!.dataset.companionFollowingPointer).toBe(
      "true",
    );
    expect(
      handle.mock.calls.some(
        ([event]) => event.type === "look" && event.value.x !== 0,
      ),
    ).toBe(true);
    // Feedback completes on the animation clock without needing another mouse event.
    act(() => {
      phase = "completed";
      changed();
    });
    expect(host.querySelector("svg")!.dataset.companionFollowingPointer).toBe(
      "false",
    );
    for (let i = 0; i < 400; i++) act(() => frame(i * 50));
    expect(host.querySelector("svg")!.dataset.companionFollowingPointer).toBe(
      "true",
    );
  });
}
