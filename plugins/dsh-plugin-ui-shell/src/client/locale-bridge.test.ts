// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SettingsScope,
  SettingsScopeSnapshot,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { LocaleSettings } from "@deepseek-ai/dsh-client-locale/client";
import { getCurrentLanguage, type LanguagePreference } from "@amiba/i18n";

import {
  connectOfficialLocale,
  LOCALE_SETTINGS_NAMESPACE,
  migrateLegacyLanguagePreference,
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

/** A stand-in for the official durable locale section. */
function fakeScope(initial: Partial<SettingsScopeSnapshot<LocaleSettings>>) {
  const listeners = new Set<() => void>();
  let snapshot: SettingsScopeSnapshot<LocaleSettings> = {
    status: "loading",
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: true,
    mode: "host",
    ...initial,
  };
  const scope: SettingsScope<LocaleSettings> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: async () => undefined,
    unset: async () => undefined,
  };
  return {
    scope,
    listenerCount: () => listeners.size,
    publish(next: Partial<SettingsScopeSnapshot<LocaleSettings>>) {
      snapshot = { ...snapshot, ...next };
      for (const listener of [...listeners]) listener();
    },
  };
}

/** Let the migration's `loadPreference().then(...)` chain settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function preference(value: LanguagePreference): () => Promise<LanguagePreference> {
  return () => Promise.resolve(value);
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
    const settings = fakeScope({ status: "loading" });
    disposers.push(
      connectOfficialLocale({
        locale: locale.runtime,
        localeSettings: settings.scope,
        loadPreference: preference("auto"),
      }),
    );
    expect(getCurrentLanguage()).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("re-publishes on an official switch", () => {
    const locale = fakeLocale("zh");
    const settings = fakeScope({ status: "loading" });
    disposers.push(
      connectOfficialLocale({
        locale: locale.runtime,
        localeSettings: settings.scope,
        loadPreference: preference("auto"),
      }),
    );
    locale.runtime.setLocale("en");
    expect(getCurrentLanguage()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("the one-time migration of settings.ui.language", () => {
  it("carries a stored en choice over once the official section says nothing is chosen", async () => {
    const locale = fakeLocale("zh");
    const settings = fakeScope({ status: "loading" });
    const markMigrated = vi.fn(async () => undefined);
    disposers.push(
      migrateLegacyLanguagePreference({
        locale: locale.runtime,
        localeSettings: settings.scope,
        loadPreference: preference("en"),
        markMigrated,
      }),
    );
    await settle();
    // `loading` is "not known yet", NOT "never chosen".
    expect(locale.calls).toEqual([]);

    settings.publish({ status: "ready", value: {} });
    expect(locale.calls).toEqual(["en"]);
    await settle();
    expect(markMigrated).toHaveBeenCalledTimes(1);
    // Retired: the subscription is released so a later official switch is
    // never re-interpreted as a migration opportunity.
    expect(settings.listenerCount()).toBe(0);
  });

  it("maps zh-CN onto the official zh — never onto an unregistered id", async () => {
    const locale = fakeLocale("en");
    const settings = fakeScope({ status: "ready", value: {} });
    disposers.push(
      migrateLegacyLanguagePreference({
        locale: locale.runtime,
        localeSettings: settings.scope,
        loadPreference: preference("zh-CN"),
        markMigrated: async () => undefined,
      }),
    );
    await settle();
    expect(locale.calls).toEqual(["zh"]);
    expect(locale.calls).not.toContain("zh-CN");
  });

  it("does nothing for auto — that state IS the official never-chosen state", async () => {
    const locale = fakeLocale("en");
    const settings = fakeScope({ status: "ready", value: {} });
    const markMigrated = vi.fn(async () => undefined);
    disposers.push(
      migrateLegacyLanguagePreference({
        locale: locale.runtime,
        localeSettings: settings.scope,
        loadPreference: preference("auto"),
        markMigrated,
      }),
    );
    await settle();
    expect(locale.calls).toEqual([]);
    expect(markMigrated).not.toHaveBeenCalled();
    expect(settings.listenerCount()).toBe(0);
  });

  it("leaves an existing official selection alone", async () => {
    const locale = fakeLocale("zh");
    const settings = fakeScope({
      status: "ready",
      value: { preference: "zh" },
    });
    const markMigrated = vi.fn(async () => undefined);
    disposers.push(
      migrateLegacyLanguagePreference({
        locale: locale.runtime,
        localeSettings: settings.scope,
        loadPreference: preference("en"),
        markMigrated,
      }),
    );
    await settle();
    // The user switched to 中文 officially at some point. Amiba's retired
    // preference must not flip them back on the next launch.
    expect(locale.calls).toEqual([]);
    expect(markMigrated).not.toHaveBeenCalled();
  });

  it("does not migrate into a section it cannot write", async () => {
    const locale = fakeLocale("zh");
    const settings = fakeScope({
      status: "ready",
      value: {},
      writable: false,
      mode: "memory",
    });
    const markMigrated = vi.fn(async () => undefined);
    disposers.push(
      migrateLegacyLanguagePreference({
        locale: locale.runtime,
        localeSettings: settings.scope,
        loadPreference: preference("en"),
        markMigrated,
      }),
    );
    await settle();
    // A write that cannot persist would flip the language once and lose the
    // choice at the next launch — worse than not migrating.
    expect(locale.calls).toEqual([]);
    expect(markMigrated).not.toHaveBeenCalled();
  });

  it("only ever migrates once, even if the section republishes", async () => {
    const locale = fakeLocale("zh");
    const settings = fakeScope({ status: "loading" });
    const markMigrated = vi.fn(async () => undefined);
    disposers.push(
      migrateLegacyLanguagePreference({
        locale: locale.runtime,
        localeSettings: settings.scope,
        loadPreference: preference("en"),
        markMigrated,
      }),
    );
    await settle();
    settings.publish({ status: "ready", value: {} });
    settings.publish({ status: "ready", value: {} });
    settings.publish({ status: "ready", value: { preference: "en" } });
    await settle();
    expect(locale.calls).toEqual(["en"]);
    expect(markMigrated).toHaveBeenCalledTimes(1);
  });

  it("does not run after the bridge is disposed", async () => {
    const locale = fakeLocale("zh");
    const settings = fakeScope({ status: "loading" });
    const markMigrated = vi.fn(async () => undefined);
    const dispose = migrateLegacyLanguagePreference({
      locale: locale.runtime,
      localeSettings: settings.scope,
      loadPreference: preference("en"),
      markMigrated,
    });
    dispose();
    await settle();
    settings.publish({ status: "ready", value: {} });
    expect(locale.calls).toEqual([]);
    expect(markMigrated).not.toHaveBeenCalled();
  });

  it("reports a failed preference read instead of throwing into boot", async () => {
    const locale = fakeLocale("zh");
    const settings = fakeScope({ status: "ready", value: {} });
    const onError = vi.fn();
    disposers.push(
      migrateLegacyLanguagePreference({
        locale: locale.runtime,
        localeSettings: settings.scope,
        loadPreference: () => Promise.reject(new Error("storage down")),
        markMigrated: async () => undefined,
        onError,
      }),
    );
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(locale.calls).toEqual([]);
  });
});
