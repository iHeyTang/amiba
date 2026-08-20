import {
  detectBrowserLanguage,
  fromOfficialLocaleId,
  hasOfficialLocale,
  installOfficialLocale,
  seedDocumentLanguage,
  toOfficialLocaleId,
  useT,
  type OfficialLocaleSource,
  type ResolvedLanguage,
} from "@amiba/i18n";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function LanguageProbe() {
  const { t, language } = useT();
  return (
    <>
      <span data-testid="language">{language}</span>
      <span data-testid="copy">{t("common.save")}</span>
    </>
  );
}

/** A stand-in for the official `LocaleRuntime`'s LocaleFace pair. */
function fakeOfficialLocale(active: string) {
  const listeners = new Set<() => void>();
  let snapshot = { active };
  const source: OfficialLocaleSource = {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    source,
    setLocale(next: string) {
      snapshot = { active: next };
      for (const fn of [...listeners]) fn();
    },
  };
}

/** The realm registry `@amiba/i18n` keeps the one official source on. */
interface RealmLocaleRegistry {
  source: unknown;
  unsubscribe: (() => void) | null;
  observers: Set<() => void>;
}

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  // The official source is realm state now, so a failed test must not be able
  // to leave one installed for the next. The `observers` list is left in
  // place: it holds THIS module copy's refresh hook, and dropping the whole
  // registry object would orphan it.
  const registry = (
    globalThis as unknown as Record<
      PropertyKey,
      RealmLocaleRegistry | undefined
    >
  )[Symbol.for("@amiba/i18n/official-locale")];
  if (registry?.source) {
    registry.unsubscribe?.();
    registry.unsubscribe = null;
    registry.source = null;
    for (const observer of [...registry.observers]) observer();
  }
  document.documentElement.lang = "en";
  vi.restoreAllMocks();
});

describe("the id mapping between Amiba and the official locale service", () => {
  it("never produces an id the official service has not registered", () => {
    // `LocaleRuntime.setLocale` THROWS on an unregistered id, and the two
    // shipped ids are `zh` and `en` — Amiba's own `zh-CN` is not one of them.
    const mapped: string[] = (["en", "zh-CN"] as const).map((language) =>
      toOfficialLocaleId(language),
    );
    expect(mapped).toEqual(["en", "zh"]);
    expect(mapped).not.toContain("zh-CN");
  });

  it("is total in the other direction, primary subtag first", () => {
    expect(fromOfficialLocaleId("zh")).toBe("zh-CN");
    expect(fromOfficialLocaleId("en")).toBe("en");
    // Regional variants and ids Amiba has never seen resolve rather than throw
    // inside a render, the way the official plugin's own browser detection does.
    expect(fromOfficialLocaleId("zh-Hans-CN")).toBe("zh-CN");
    expect(fromOfficialLocaleId("en-GB")).toBe("en");
    expect(fromOfficialLocaleId("fr")).toBe("en");
  });

  it("round-trips every Amiba language", () => {
    for (const language of ["en", "zh-CN"] as ResolvedLanguage[]) {
      expect(fromOfficialLocaleId(toOfficialLocaleId(language))).toBe(language);
    }
  });
});

describe("with a DSH plugin runtime (official locale installed)", () => {
  it("takes the official locale as the authority and re-renders Amiba copy on a switch", () => {
    const official = fakeOfficialLocale("en");
    disposers.push(installOfficialLocale(official.source));
    expect(hasOfficialLocale()).toBe(true);

    render(<LanguageProbe />);
    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(screen.getByTestId("copy")).toHaveTextContent("Save");

    act(() => {
      official.setLocale("zh");
    });

    // No reload: the same mounted tree now renders the zh-CN catalog.
    expect(screen.getByTestId("language")).toHaveTextContent("zh-CN");
    expect(screen.getByTestId("copy")).toHaveTextContent("保存");
  });

  it("keeps `<html lang>` truthful for the surfaces that read it directly", () => {
    const official = fakeOfficialLocale("zh");
    disposers.push(installOfficialLocale(official.source));
    expect(document.documentElement.lang).toBe("zh-CN");

    act(() => {
      official.setLocale("en");
    });
    expect(document.documentElement.lang).toBe("en");
  });

  it("outranks the document contract while installed", () => {
    const official = fakeOfficialLocale("zh");
    disposers.push(installOfficialLocale(official.source));
    render(<LanguageProbe />);
    expect(screen.getByTestId("language")).toHaveTextContent("zh-CN");
  });
});

describe("with NO plugin runtime (Quick-Ask, the notifier)", () => {
  it("resolves from navigator when the document declares nothing", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");
    expect(hasOfficialLocale()).toBe(false);
    expect(detectBrowserLanguage()).toBe("zh-CN");
  });

  it("seeds the window's document language from the browser", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");
    // index.html ships a static `lang="en"`; seeding replaces it, which is
    // both the a11y fix and what makes the document contract truthful for a
    // window that will never install an official source.
    document.documentElement.lang = "en";

    expect(seedDocumentLanguage()).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");

    render(<LanguageProbe />);
    expect(screen.getByTestId("language")).toHaveTextContent("zh-CN");
    expect(screen.getByTestId("copy")).toHaveTextContent("保存");
  });

  it("follows the document contract when no official source exists at all", async () => {
    // Other PLUGIN BUNDLES no longer depend on this path — the official
    // source is realm-wide now (see `i18n-cross-bundle-locale.test.tsx`).
    // What is left is the genuinely runtime-less window: a surface whose
    // `<html lang>` was seeded at boot and can still change under it.
    document.documentElement.lang = "en";
    render(<LanguageProbe />);
    expect(screen.getByTestId("language")).toHaveTextContent("en");

    await act(async () => {
      document.documentElement.lang = "zh-CN";
      // The MutationObserver delivers on a microtask.
      await Promise.resolve();
    });
    expect(screen.getByTestId("language")).toHaveTextContent("zh-CN");
    expect(screen.getByTestId("copy")).toHaveTextContent("保存");
  });
});
