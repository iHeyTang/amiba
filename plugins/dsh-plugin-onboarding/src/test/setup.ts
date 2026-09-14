import "@testing-library/jest-dom/vitest";
import {
  hasPlatform,
  setPlatform,
  type PlatformAdapter,
} from "@amiba/app-runtime/platform";
import { installMessageCatalog } from "@amiba/i18n";
import { en, zhCN } from "@amiba/ui/locales";

// `ModelPickerDialog` and friends come from `@amiba/ui/plugin` and call
// `useT()`, which resolves against the realm's message registry. In the
// product the shell fills that registry from the official locale namespace; a
// test realm has no shell, so it plays the runtime-less part and installs the
// host catalogs directly — the same entry point Quick-Ask uses. Without it the
// assertions would read raw dotted keys.
installMessageCatalog({ en, "zh-CN": zhCN });

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

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function () {};
}

// Radix Select/Dialog use pointer-capture APIs that jsdom does not implement.
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
