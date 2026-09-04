import "@testing-library/jest-dom/vitest";
import {
  hasPlatform,
  setPlatform,
  type PlatformAdapter,
} from "@amiba/app-runtime/platform";

// cmdk (and some Radix primitives) use ResizeObserver internally; jsdom does
// not implement it, so provide a minimal no-op stub for the test
// environment.
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

// `state.ts` reaches for the platform via `getPlatform().storage` in
// `index.tsx`'s `apply()`; without one installed, that call throws
// "PlatformAdapter not initialized". Install a minimal in-memory adapter
// (the app does the real one at boot). Individual tests pass their own
// fake `storage` directly into `createPinState`, so this fallback only
// matters for code paths that call `getPlatform()` itself.
if (!hasPlatform()) {
  const storage = {
    get: async () => ({}),
    set: async () => {},
    remove: async () => {},
    watch: () => () => {},
  };
  setPlatform({ storage } as unknown as PlatformAdapter);
}
