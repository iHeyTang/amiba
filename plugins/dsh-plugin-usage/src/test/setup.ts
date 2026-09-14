import { vi } from "vitest";
// The host supplies this module factory in DSH; unit tests supply its public seam.
vi.mock("@amiba/dsh-plugin-ui-shell/client", async () => ({
  getPlatform: (await import("@amiba/app-runtime/platform")).getPlatform,
}));
import "@testing-library/jest-dom/vitest";
import {
  hasPlatform,
  setPlatform,
  type PlatformAdapter,
} from "@amiba/app-runtime/platform";

// cmdk (and some Radix primitives) use ResizeObserver internally; jsdom does
// not implement it, so provide a minimal no-op stub for the test
// environment. The Tokens tab's heatmap/tooltip primitives touch this path.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function () {};
}

// Radix tooltip/popover primitives use pointer-capture APIs jsdom does not
// implement.
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = function () {
    return false;
  };
}
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = function () {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = function () {};
}

// `prefs.ts` reaches for the platform via `getPlatform().storage`; without
// one installed, its calls throw "PlatformAdapter not initialized". Install
// a minimal in-memory adapter (the app does the real one at boot).
// Individual tests can still override it with their own mock.
if (!hasPlatform()) {
  const storage = {
    get: async () => ({}),
    set: async () => {},
    remove: async () => {},
    watch: () => () => {},
  };
  setPlatform({ storage } as unknown as PlatformAdapter);
}
