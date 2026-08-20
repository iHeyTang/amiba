import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

import { SettingsPageActions } from "../page-chrome";
import { SettingsView } from "../SettingsView";

/**
 * Render sites of the newly adopted `settings.*` seats.
 *
 * The nodes below stand in for what `renderSlot` hands the host — a fixture
 * plugin's contribution. The assertions are about PLACEMENT, because that is
 * the half of a slot contract types cannot check.
 */
function seat(name: string) {
  return <span data-testid={`seat-${name}`}>{name} seat</span>;
}

describe("adopted settings.* seats", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/#appearance");
    setPlatform({
      kind: "desktop",
      storage: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
        watch: vi.fn(() => () => {}),
      },
    } as unknown as PlatformAdapter);
  });

  it("renders settings.header as the navigation heading and names the dialog after it", () => {
    render(
      <SettingsView headerId="dialog-title" slots={{ header: seat("header") }} />,
    );
    const header = screen.getByTestId("seat-header");
    expect(header.closest("#dialog-title")).not.toBeNull();
    // The heading lives in the navigation column, above the section list.
    expect(
      within(screen.getByTestId("settings-sidebar")).getByTestId("seat-header"),
    ).toBe(header);
  });

  it("falls back to Amiba's own title when settings.header is unoccupied", () => {
    render(<SettingsView headerId="dialog-title" />);
    expect(document.querySelector("#dialog-title")).toHaveTextContent(
      "Settings",
    );
  });

  it("renders settings.action in the page header, before the in-tree actions portal", () => {
    render(<SettingsView slots={{ action: seat("action") }} />);
    const action = screen.getByTestId("seat-action");
    const trailing = action.parentElement;
    expect(trailing).not.toBeNull();
    const portal = trailing!.querySelector("[data-settings-page-actions]");
    expect(portal).not.toBeNull();
    // Ordering: seat, then the portal container, then (when hosted in the
    // dialog) the close control — the official shell's actions-before-Close.
    expect(
      action.compareDocumentPosition(portal!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lets the settings.action seat and the in-tree actions portal coexist", () => {
    window.history.replaceState(null, "", "/#dsh:skills");
    render(
      <SettingsView
        dshSections={[{ id: "skills", label: "Skills" }]}
        slots={{
          action: seat("action"),
          section: () => (
            <SettingsPageActions>
              <button type="button">Refresh</button>
            </SettingsPageActions>
          ),
        }}
      />,
    );
    expect(screen.getByTestId("seat-action")).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeVisible();
  });

  it("gives the dialog close button its accessible name from the settings.close seat", () => {
    render(
      <SettingsView
        closeLabel="Dismiss settings"
        onClose={() => {}}
        slots={{ header: seat("header") }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Dismiss settings" }),
    ).toBeVisible();
  });

  it("names the close button from Amiba's own copy when settings.close is unoccupied", () => {
    render(<SettingsView onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible();
  });

  it("renders no close control at all outside the dialog host", () => {
    const { container } = render(<SettingsView />);
    expect(container.querySelector("[data-settings-close]")).toBeNull();
  });

  it("renders settings.general.item inside the General section (Appearance), after the product's own rows", () => {
    render(<SettingsView slots={{ generalItem: seat("general-item") }} />);
    const item = screen.getByTestId("seat-general-item");
    const rows = item.parentElement;
    expect(rows).not.toBeNull();
    // The seat is the LAST child of the page's row stack, so contributed
    // rows append below the product's own instead of interleaving.
    expect(rows!.lastElementChild).toBe(item);
    // Same stack as the language/theme rows.
    expect(
      within(rows as HTMLElement).getByRole("radiogroup", {
        name: "Language",
      }),
    ).toBeVisible();
  });

  it("does not leak the general-item seat onto other pages", () => {
    window.history.replaceState(null, "", "/#logs");
    render(<SettingsView slots={{ generalItem: seat("general-item") }} />);
    expect(screen.queryByTestId("seat-general-item")).not.toBeInTheDocument();
  });
});
