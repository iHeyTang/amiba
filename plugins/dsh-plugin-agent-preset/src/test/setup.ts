import "@testing-library/jest-dom/vitest";
import { installMessageCatalog } from "@amiba/i18n";
import { en, zhCN } from "@amiba/ui/locales";

// This plugin's components reach the shared vocabulary (`common.*`) through
// `usePluginT`'s host fallback, which resolves against the realm's message
// registry. In the product the shell fills that registry from the official
// locale namespace; a test realm has no shell, so it plays the runtime-less
// part and installs the host catalogs directly — the same entry point
// Quick-Ask uses. Without it the assertions would read raw dotted keys.
installMessageCatalog({ en, "zh-CN": zhCN });

// Radix primitives use ResizeObserver, scrollIntoView, and pointer-capture
// APIs internally; jsdom does not implement them, so provide minimal no-op
// stubs for the test environment.
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
