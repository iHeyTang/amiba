// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getCurrentLanguage } from "@amiba/i18n";

import {
  connectOfficialLocale,
  LOCALE_SETTINGS_NAMESPACE,
  type OfficialLocaleRuntime,
} from "./locale-bridge.js";

/**
 * A stand-in for the official `LocaleRuntime` carrying only the three members
 * the bridge uses. `setLocale` reproduces the one behaviour that makes the id
 * mapping load-bearing: an unregistered id THROWS.
 */
function fakeLocale(active: string) {
  const listeners = new Set<() => void>();
  let snapshot = { active };
  const calls: string[] = [];
  const runtime: OfficialLocaleRuntime = {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setLocale: (id) => {
      calls.push(id);
      if (id !== "zh" && id !== "en") {
        throw new Error(`locale "${id}" is not registered`);
      }
      snapshot = { active: id };
      for (const fn of [...listeners]) fn();
    },
  };
  return { runtime, calls };
}

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  document.documentElement.lang = "en";
});

describe("the official settings namespace", () => {
  it("is upstream's own, not a private Amiba one", () => {
    // Tied to `LOCALE_SETTINGS_NAMESPACE` in
    // `@deepseek-ai/dsh-client-locale`'s locale-settings contract; the
    // literal is annotated with upstream's const type, so a rename there is
    // a compile error and this is the runtime half of the same pin.
    expect(LOCALE_SETTINGS_NAMESPACE).toBe("locale");
  });
});

describe("official locale as Amiba's language authority", () => {
  it("adopts the official active locale for Amiba's own copy", () => {
    const locale = fakeLocale("zh");
    disposers.push(
      connectOfficialLocale({
        locale: locale.runtime,
      }),
    );
    expect(getCurrentLanguage()).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("re-publishes on an official switch", () => {
    const locale = fakeLocale("zh");
    disposers.push(
      connectOfficialLocale({
        locale: locale.runtime,
      }),
    );
    locale.runtime.setLocale("en");
    expect(getCurrentLanguage()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
