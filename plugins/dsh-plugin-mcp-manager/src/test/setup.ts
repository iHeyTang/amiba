import "@testing-library/jest-dom/vitest";
import {
  hasPlatform,
  setPlatform,
  type PlatformAdapter,
} from "@amiba/app-runtime/platform";

// cmdk (and some Radix primitives) use ResizeObserver and scrollIntoView
// internally; jsdom does not implement them, so provide minimal no-op stubs
// for the test environment.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function () {};
}

// Radix Select/Dialog use pointer-capture APIs that jsdom does not implement.
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = function () {
    return false;
  };
}
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = function () {};
}
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = function () {};
}

// Components under test reach for the platform via `useT()` (i18n) and other
// hooks; without one, their effects throw "PlatformAdapter not initialized".
// Install a minimal in-memory adapter (the app does the real one at boot).
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
