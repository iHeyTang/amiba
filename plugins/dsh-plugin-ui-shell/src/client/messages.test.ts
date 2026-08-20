// @vitest-environment jsdom
import { resolveMessage } from "@amiba/i18n";
import { en as uiEn, zhCN as uiZh } from "@amiba/ui/locales";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AMIBA_LOCALE_NS,
  amibaMessages,
  installAmibaMessageCatalog,
  registerAmibaMessages,
  type AmibaLocaleRegistrar,
} from "./messages.js";
import { en as shellEn } from "./locales/index.js";

/**
 * A stand-in for the official `LocaleRuntime` carrying only the two members
 * the registration uses. `register` reproduces the behaviour that makes ONE
 * namespace load-bearing: a duplicate `(ns, locale)` THROWS.
 */
function fakeLocale(active: "zh" | "en" = "en") {
  const dicts = new Map<string, Map<string, Record<string, string>>>();
  const registrations: Array<{ ns: string; locales: string[] }> = [];
  const runtime = {
    register(ns: string, byLocale: Record<string, Record<string, string>>) {
      const locales = dicts.get(ns) ?? new Map();
      dicts.set(ns, locales);
      for (const locale of Object.keys(byLocale)) {
        if (locales.has(locale)) {
          throw new Error(
            `locale namespace "${ns}" already has locale "${locale}"`,
          );
        }
      }
      for (const [locale, dict] of Object.entries(byLocale)) {
        locales.set(locale, dict);
      }
      registrations.push({ ns, locales: Object.keys(byLocale) });
      return () => {
        for (const locale of Object.keys(byLocale)) locales.delete(locale);
      };
    },
    bind(ns: string) {
      return (key: string) =>
        dicts.get(ns)?.get(active)?.[key] ??
        dicts.get(ns)?.get("zh")?.[key] ??
        key;
    },
  };
  return {
    runtime: runtime as unknown as AmibaLocaleRegistrar,
    registrations,
    dicts,
  };
}

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

describe("the merged Amiba dictionary", () => {
  it("carries every owner's keys in both languages, and nothing else", () => {
    const owned = [
      ...Object.keys(uiEn),
      ...Object.keys(shellEn),
    ].sort();
    expect(Object.keys(amibaMessages.en).sort()).toEqual(owned);
    expect(Object.keys(amibaMessages["zh-CN"]).sort()).toEqual(owned);
  });

  it("takes each string from its own owner", () => {
    // A `@amiba/ui` key and the shell's own key, from the same merged table.
    expect(amibaMessages.en["common.save"]).toBe(uiEn["common.save"]);
    expect(amibaMessages["zh-CN"]["common.save"]).toBe(uiZh["common.save"]);
    expect(amibaMessages.en["app.initializing"]).toBe(
      shellEn["app.initializing"],
    );
  });
});

describe("registerAmibaMessages", () => {
  it("registers ONE namespace, once, keyed by the OFFICIAL locale ids", () => {
    const locale = fakeLocale();
    disposers.push(registerAmibaMessages(locale.runtime));

    expect(locale.registrations).toEqual([
      { ns: AMIBA_LOCALE_NS, locales: ["zh", "en"] },
    ]);
    // The id mapping, proven on the payload rather than asserted: the `zh`
    // slot holds Amiba's `zh-CN` catalog. `setLocale` throws on `zh-CN`, and
    // `register` would silently create a locale nothing ever selects.
    expect(locale.dicts.get(AMIBA_LOCALE_NS)?.get("zh")).toEqual(
      amibaMessages["zh-CN"],
    );
    expect(locale.dicts.get(AMIBA_LOCALE_NS)?.get("en")).toEqual(
      amibaMessages.en,
    );
  });

  it("throws if something registers the same namespace twice", () => {
    const locale = fakeLocale();
    disposers.push(registerAmibaMessages(locale.runtime));
    expect(() => registerAmibaMessages(locale.runtime)).toThrow(
      /already has locale/u,
    );
  });

  it("makes the bound translate the realm's template source", () => {
    const locale = fakeLocale("en");
    const bind = vi.spyOn(locale.runtime, "bind");
    disposers.push(registerAmibaMessages(locale.runtime));

    expect(bind).toHaveBeenCalledWith(AMIBA_LOCALE_NS);
    expect(resolveMessage("common.save", "en")).toBe(uiEn["common.save"]);
    expect(resolveMessage("app.initializing", "en")).toBe(
      shellEn["app.initializing"],
    );
  });

  it("answers an unknown key with the key itself, through upstream's own miss path", () => {
    const locale = fakeLocale("en");
    disposers.push(registerAmibaMessages(locale.runtime));
    expect(resolveMessage("options.someplugin.local", "en")).toBe(
      "options.someplugin.local",
    );
  });

  it("supersedes the compile-time catalogs and restores them when disposed", () => {
    disposers.push(installAmibaMessageCatalog());
    expect(resolveMessage("common.save", "en")).toBe(uiEn["common.save"]);

    const locale = fakeLocale("zh");
    const disposeRegistration = registerAmibaMessages(locale.runtime);
    // The official source reads ITS active locale, which is `zh` here — the
    // asking copy's `language` argument is ignored, exactly as documented.
    expect(resolveMessage("common.save", "en")).toBe(uiZh["common.save"]);

    disposeRegistration();
    // Back to the catalogs, not to raw keys: a composition that loses the
    // locale service must not lose its copy.
    expect(resolveMessage("common.save", "en")).toBe(uiEn["common.save"]);
  });
});
