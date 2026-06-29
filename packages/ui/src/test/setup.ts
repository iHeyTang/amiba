import "@testing-library/jest-dom/vitest"
import { hasPlatform, setPlatform, type PlatformAdapter } from "@amiba/platform"

// cmdk (and some Radix primitives) use ResizeObserver and scrollIntoView
// internally; jsdom does not implement them, so provide minimal no-op stubs
// for the test environment.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function () {}
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
  }
  setPlatform({ storage } as unknown as PlatformAdapter)
}
