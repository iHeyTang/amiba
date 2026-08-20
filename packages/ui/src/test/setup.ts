import "@testing-library/jest-dom/vitest";
import {
  hasPlatform,
  setPlatform,
  type PlatformAdapter,
} from "@amiba/app-runtime/platform";
import { installMessageCatalog } from "@amiba/i18n";

import { en, zhCN } from "../locales";

// The dictionary is no longer compiled into `@amiba/i18n`: in the product it
// is installed into the realm by whoever owns it (the shell's official
// namespace registration, or a runtime-less window's catalogs). A test realm
// has neither, so it plays the runtime-less part and installs this package's
// own catalogs — the SAME entry point Quick-Ask imports. Cases that only care
// about which key a component asks for still mock `@amiba/i18n` themselves and
// are unaffected.
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

// Radix Select uses pointer-capture APIs that jsdom does not implement.
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
