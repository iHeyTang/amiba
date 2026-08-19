/**
 * Guard for the realm-shared ChromeContext (fix 5e13096).
 *
 * Every DSH client plugin inlines its own copy of `@amiba/ui`, so the
 * settings page-chrome context is consumed from a DIFFERENT module instance
 * than the one the scaffold provides. A module-scoped `createContext` mints
 * one context object per copy and the header actions silently never render —
 * a failure ordinary unit tests cannot see, because one vitest worker
 * resolves the workspace source exactly once.
 *
 * This test manufactures the second copy for real: `vi.resetModules()`
 * clears vitest's module registry, so a second dynamic import re-evaluates
 * page-chrome while React itself (resolved through Node's external cache,
 * exactly like the shell's frozen platform-module table) stays shared. If
 * the context ever moves off the realm-wide `Symbol.for` registry, copy B's
 * `SettingsPageActions` stops seeing copy A's provider and this test fails.
 */
import { render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

type PageChromeModule = typeof import("../page-chrome");

async function importTwoCopies(): Promise<{
  copyA: PageChromeModule;
  copyB: PageChromeModule;
}> {
  vi.resetModules();
  const copyA = await import("../page-chrome");
  vi.resetModules();
  const copyB = await import("../page-chrome");
  expect(copyB).not.toBe(copyA);
  return { copyA, copyB };
}

function ActionsHost({ chrome }: { chrome: PageChromeModule }): ReactNode {
  const { setActionsHost } = chrome.useSettingsPageChrome();
  useEffect(() => () => setActionsHost(null), [setActionsHost]);
  return <div data-testid="actions-host" ref={setActionsHost} />;
}

describe("settings page-chrome across plugin bundle copies", () => {
  it("copy B's SettingsPageActions portals into copy A's provider host", async () => {
    const { copyA, copyB } = await importTwoCopies();
    const ProviderA = copyA.SettingsPageChromeProvider;
    const ActionsB = copyB.SettingsPageActions;

    render(
      <ProviderA>
        <ActionsHost chrome={copyA} />
        <ActionsB>
          <button type="button">cross-bundle action</button>
        </ActionsB>
      </ProviderA>,
    );

    const host = screen.getByTestId("actions-host");
    const button = await screen.findByRole("button", {
      name: "cross-bundle action",
    });
    expect(host.contains(button)).toBe(true);
  });
});
