import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsPageScaffold } from "../SettingsPageScaffold";
import { SettingsPageActions, useSettingsPageHeader } from "../page-chrome";

describe("SettingsPageScaffold", () => {
  it("renders head title, page actions, and width-constrained body", () => {
    render(
      <SettingsPageScaffold title="Appearance" headerHeightPx={48}>
        <SettingsPageActions>
          <button type="button">Save</button>
        </SettingsPageActions>
        <p>Body</p>
      </SettingsPageScaffold>,
    );
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    const body = screen.getByText("Body");
    expect(body.closest(".max-w-3xl")).not.toBeNull();
  });

  it("lets a drill-in page override the head with back + item title", async () => {
    const onBack = vi.fn();
    function Detail() {
      useSettingsPageHeader({ title: "my-preset", onBack });
      return <p>Detail body</p>;
    }
    render(
      <SettingsPageScaffold title="Agents">
        <Detail />
      </SettingsPageScaffold>,
    );
    expect(screen.getByRole("heading", { name: "my-preset" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Agents" })).toBeNull();
    screen.getByRole("button", { name: "Back" }).click();
    expect(onBack).toHaveBeenCalled();
  });

  it("self scroll mode fills instead of wrapping in PageContent", () => {
    render(
      <SettingsPageScaffold title="Agents" scroll="self">
        <p>Fill</p>
      </SettingsPageScaffold>,
    );
    expect(screen.getByText("Fill").closest(".max-w-3xl")).toBeNull();
  });

  it("reports the actions host node outward", () => {
    const spy = vi.fn();
    render(
      <SettingsPageScaffold title="T" onActionsHostChange={spy}>
        x
      </SettingsPageScaffold>,
    );
    expect(spy).toHaveBeenCalledWith(expect.any(HTMLElement));
  });
});
