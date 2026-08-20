/**
 * The realm MESSAGE registry — where Amiba's templates come from now that the
 * catalogs live with their owners instead of inside `@amiba/i18n`.
 *
 * Three properties are worth a test, and each one has a failure mode that
 * would ship as "the whole product renders raw dotted keys":
 *
 *  1. **Fail loud.** No source installed => the key itself, never blank.
 *  2. **Late arrival repaints.** The shell registers its namespace inside
 *     `ctx.inject(["locale"], …)`, which resolves whenever the locale service
 *     does — possibly after the product shell has already rendered. A snapshot
 *     that carried only the language would be `Object.is`-equal across that
 *     install and React would bail out of the re-render.
 *  3. **Supersede and restore.** The shell installs its compile-time catalogs
 *     first (so a composition without `dsh-client-locale` still shows copy) and
 *     the official namespace binding on top. Disposing the official one must
 *     fall back to the catalogs, not to nothing.
 *
 * `usePluginT` gets 1–3 as well: its host-vocabulary fallback reads the same
 * registry, and it is the hook every DSH plugin's components use.
 */
import {
  installMessageCatalog,
  installMessages,
  useT,
  type MessageCatalog,
  type MessageResolver,
} from "@amiba/i18n";
import { usePluginT } from "@amiba/i18n/plugin";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/** The realm slot `./messages.ts` keeps the one template source on. */
interface RealmMessageRegistry {
  resolve: MessageResolver | null;
  epoch: number;
  observers: Set<() => void>;
}

function messageRegistry(): RealmMessageRegistry {
  return (
    globalThis as unknown as Record<PropertyKey, RealmMessageRegistry>
  )[Symbol.for("@amiba/i18n/messages")];
}

/**
 * The suite starts from an EMPTY registry, because `src/test/setup.ts`
 * installs this package's catalogs for every other suite. Restored afterwards
 * so the rest of the run is unaffected.
 */
const baseline = messageRegistry().resolve;

function clearRegistry(): void {
  const registry = messageRegistry();
  registry.resolve = null;
  registry.epoch += 1;
  for (const observer of [...registry.observers]) observer();
}

const disposers: Array<() => void> = [];
const documentLanguage = document.documentElement.lang;

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  // The document language is realm state too, and `usePluginT` reads it
  // synchronously at render — a test that left it set would silently decide
  // the next one's language.
  document.documentElement.lang = documentLanguage;
  await flushLanguageObserver();
  const registry = messageRegistry();
  registry.resolve = baseline;
  registry.epoch += 1;
  for (const observer of [...registry.observers]) observer();
});

/**
 * jsdom delivers MutationObserver records on a microtask, and `useT`'s
 * language cache only advances when that record arrives. Awaiting one is what
 * makes a `<html lang>` write observable to it in a test.
 */
async function flushLanguageObserver(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const catalog: MessageCatalog = {
  en: { "common.save": "Save", "common.cancel": "Cancel" },
  "zh-CN": { "common.save": "保存", "common.cancel": "取消" },
};

function HostProbe() {
  const { t } = useT();
  return <span data-testid="copy">{t("common.save")}</span>;
}

function PluginProbe({ overlay }: { overlay?: MessageCatalog }) {
  const { t } = usePluginT(overlay);
  return (
    <>
      <span data-testid="host">{t("common.save")}</span>
      <span data-testid="own">{t("options.example.title")}</span>
    </>
  );
}

describe("useT over the realm message registry", () => {
  it("renders the raw key when no owner has installed a dictionary", () => {
    clearRegistry();
    render(<HostProbe />);
    expect(screen.getByTestId("copy")).toHaveTextContent("common.save");
  });

  it("renders an owner's copy when the catalog is installed before the first render", () => {
    clearRegistry();
    disposers.push(installMessageCatalog(catalog));
    render(<HostProbe />);
    expect(screen.getByTestId("copy")).toHaveTextContent("Save");
  });

  it("repaints an ALREADY MOUNTED tree when the dictionary arrives late", () => {
    clearRegistry();
    render(<HostProbe />);
    expect(screen.getByTestId("copy")).toHaveTextContent("common.save");

    act(() => {
      disposers.push(installMessageCatalog(catalog));
    });

    // The language never changed — only the registry did. Without the epoch in
    // the store snapshot this still reads "common.save".
    expect(screen.getByTestId("copy")).toHaveTextContent("Save");
  });

  it("lets a later install supersede an earlier one and restores it on dispose", () => {
    clearRegistry();
    disposers.push(installMessageCatalog(catalog));
    render(<HostProbe />);
    expect(screen.getByTestId("copy")).toHaveTextContent("Save");

    let disposeOfficial = (): void => {};
    act(() => {
      disposeOfficial = installMessages(() => "Save (official)");
    });
    expect(screen.getByTestId("copy")).toHaveTextContent("Save (official)");

    act(() => {
      disposeOfficial();
    });
    expect(screen.getByTestId("copy")).toHaveTextContent("Save");
  });

  it("ignores an out-of-order dispose instead of clobbering the current source", () => {
    clearRegistry();
    const disposeFirst = installMessages(() => "first");
    disposers.push(installMessages(() => "second"));
    disposeFirst();
    render(<HostProbe />);
    expect(screen.getByTestId("copy")).toHaveTextContent("second");
  });

  it("reads the language the asking copy resolved, not a fixed one", async () => {
    clearRegistry();
    disposers.push(installMessageCatalog(catalog));
    document.documentElement.lang = "zh-CN";
    await flushLanguageObserver();
    render(<HostProbe />);
    expect(screen.getByTestId("copy")).toHaveTextContent("保存");
  });
});

describe("usePluginT over the realm message registry", () => {
  const overlay: MessageCatalog = {
    en: { "options.example.title": "Example plugin" },
    "zh-CN": { "options.example.title": "示例插件" },
  };

  it("serves a plugin's own overlay even with no host dictionary at all", () => {
    clearRegistry();
    render(<PluginProbe overlay={overlay} />);
    expect(screen.getByTestId("own")).toHaveTextContent("Example plugin");
    expect(screen.getByTestId("host")).toHaveTextContent("common.save");
  });

  it("falls through to the host vocabulary the realm holds", () => {
    clearRegistry();
    disposers.push(installMessageCatalog(catalog));
    render(<PluginProbe overlay={overlay} />);
    expect(screen.getByTestId("host")).toHaveTextContent("Save");
  });

  it("repaints a mounted plugin tree when the host dictionary arrives late", () => {
    clearRegistry();
    render(<PluginProbe overlay={overlay} />);
    expect(screen.getByTestId("host")).toHaveTextContent("common.save");

    act(() => {
      disposers.push(installMessageCatalog(catalog));
    });

    expect(screen.getByTestId("host")).toHaveTextContent("Save");
    expect(screen.getByTestId("own")).toHaveTextContent("Example plugin");
  });
});
