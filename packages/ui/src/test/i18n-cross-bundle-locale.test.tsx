/**
 * Guard for the realm-shared official locale source.
 *
 * `@amiba/i18n` is compiled into ~10 bundles (`@amiba/ui` alone, which calls
 * `useT()`, is inlined into eight plugins), so this module's state exists once
 * per bundle. Only ONE of those bundles owns a DSH `ctx` and can therefore
 * call `installOfficialLocale`; when the source lived in a module-level `let`,
 * every other copy stayed on the no-runtime fallback and could only learn the
 * language through `document.documentElement.lang` — an ASYNCHRONOUS
 * MutationObserver hop.
 *
 * This test manufactures the second copy for real, the same way
 * `settings/__tests__/page-chrome-cross-bundle.test.tsx` does: `vi.resetModules()`
 * clears vitest's module registry, so a second dynamic import re-evaluates
 * `@amiba/i18n` while React (externalized, like the shell's frozen platform
 * module table) stays shared.
 *
 * Every assertion here is made SYNCHRONOUSLY, in the same task as the switch.
 * That is what separates the registry path from the document path: the DOM
 * attribute is still published, but its observers only fire on a later
 * microtask, so a copy that learns in the same tick can only have learned
 * through the realm registry.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type I18nModule = typeof import("@amiba/i18n");

const OFFICIAL_LOCALE_KEY = Symbol.for("@amiba/i18n/official-locale");

function clearRealmRegistry(): void {
  const realm = globalThis as unknown as Record<PropertyKey, unknown>;
  delete realm[OFFICIAL_LOCALE_KEY];
}

async function importTwoCopies(): Promise<{
  copyA: I18nModule;
  copyB: I18nModule;
}> {
  vi.resetModules();
  const copyA = await import("@amiba/i18n");
  vi.resetModules();
  const copyB = await import("@amiba/i18n");
  // Two distinct module instances — the situation the bundler creates.
  expect(copyB).not.toBe(copyA);
  return { copyA, copyB };
}

/** A stand-in for the official `LocaleRuntime`'s LocaleFace pair. */
function fakeOfficialLocale(active: string) {
  const listeners = new Set<() => void>();
  let snapshot = { active };
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    subscriberCount: () => listeners.size,
    setLocale(next: string) {
      snapshot = { active: next };
      for (const fn of [...listeners]) fn();
    },
  };
}

function probeOf(copy: I18nModule) {
  return function LanguageProbe() {
    const { t, language } = copy.useT();
    return (
      <>
        <span data-testid="language">{language}</span>
        <span data-testid="copy">{t("common.save")}</span>
      </>
    );
  };
}

const disposers: Array<() => void> = [];

beforeEach(() => {
  clearRealmRegistry();
  document.documentElement.lang = "en";
});

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  clearRealmRegistry();
  document.documentElement.lang = "en";
});

describe("the official locale source across plugin bundle copies", () => {
  it("wakes a copy that was already mounted when another copy installs", async () => {
    const { copyA, copyB } = await importTwoCopies();
    const ProbeB = probeOf(copyB);

    // Copy B mounts FIRST, with no source anywhere — the state every plugin
    // bundle is in while the shell is still booting.
    render(<ProbeB />);
    expect(screen.getByTestId("language")).toHaveTextContent("en");

    const official = fakeOfficialLocale("zh");
    act(() => {
      disposers.push(copyA.installOfficialLocale(official.source));
    });

    // Same task, no awaited microtask: only the install-notification list can
    // have delivered this.
    expect(screen.getByTestId("language")).toHaveTextContent("zh-CN");
    expect(screen.getByTestId("copy")).toHaveTextContent("保存");
  });

  it("re-renders a non-installing copy on an official switch, in the same tick", async () => {
    const { copyA, copyB } = await importTwoCopies();
    const official = fakeOfficialLocale("en");
    disposers.push(copyA.installOfficialLocale(official.source));

    const ProbeB = probeOf(copyB);
    render(<ProbeB />);
    expect(screen.getByTestId("copy")).toHaveTextContent("Save");

    act(() => {
      official.setLocale("zh");
    });
    expect(screen.getByTestId("language")).toHaveTextContent("zh-CN");
    expect(screen.getByTestId("copy")).toHaveTextContent("保存");
  });

  it("reports the source from every copy and takes exactly one subscription", async () => {
    const { copyA, copyB } = await importTwoCopies();
    expect(copyA.hasOfficialLocale()).toBe(false);
    expect(copyB.hasOfficialLocale()).toBe(false);

    const official = fakeOfficialLocale("zh");
    disposers.push(copyA.installOfficialLocale(official.source));

    expect(copyB.hasOfficialLocale()).toBe(true);
    expect(copyB.getCurrentLanguage()).toBe("zh-CN");
    // The realm subscribes ONCE and fans out; N copies must not mean N
    // listeners on the official runtime.
    expect(official.subscriberCount()).toBe(1);
  });

  it("restores the no-runtime fallback in every copy when the source is disposed", async () => {
    const { copyA, copyB } = await importTwoCopies();
    const official = fakeOfficialLocale("zh");
    const dispose = copyA.installOfficialLocale(official.source);
    expect(copyB.hasOfficialLocale()).toBe(true);

    document.documentElement.lang = "en";
    dispose();

    expect(copyA.hasOfficialLocale()).toBe(false);
    expect(copyB.hasOfficialLocale()).toBe(false);
    expect(copyB.getCurrentLanguage()).toBe("en");
    expect(official.subscriberCount()).toBe(0);
  });
});

describe("the global / not-global boundary", () => {
  it("keeps each copy's subscribers its own — one switch, one notification", async () => {
    // The SOURCE is realm-wide; `languageSubscribers` / `storeSubscribers` /
    // `cachedLanguage` are deliberately not. If the subscriber sets were
    // hoisted onto the realm too, every copy's `refreshLanguage` would walk
    // the SAME list and each listener would fire once per copy.
    const { copyA, copyB } = await importTwoCopies();
    const official = fakeOfficialLocale("en");
    disposers.push(copyA.installOfficialLocale(official.source));

    const seenByA: string[] = [];
    const seenByB: string[] = [];
    disposers.push(copyA.subscribeLanguage((next) => seenByA.push(next)));
    disposers.push(copyB.subscribeLanguage((next) => seenByB.push(next)));

    act(() => {
      official.setLocale("zh");
    });

    expect(seenByA).toEqual(["zh-CN"]);
    expect(seenByB).toEqual(["zh-CN"]);
  });

  it("does not let one copy's unsubscribe silence another copy", async () => {
    const { copyA, copyB } = await importTwoCopies();
    const official = fakeOfficialLocale("en");
    disposers.push(copyA.installOfficialLocale(official.source));

    const seenByB: string[] = [];
    const stopA = copyA.subscribeLanguage(() => {});
    disposers.push(copyB.subscribeLanguage((next) => seenByB.push(next)));
    stopA();

    act(() => {
      official.setLocale("zh");
    });
    expect(seenByB).toEqual(["zh-CN"]);
  });
});
