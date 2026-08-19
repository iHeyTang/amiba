import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

import {
  SettingsPageActionButton,
  SettingsPageActions,
  SettingsPageChromeProvider,
  SettingsPageDescription,
  useSettingsPageChrome,
  useSettingsPageHeader,
} from "../page-chrome";

function Harness({ children }: { children: React.ReactNode }) {
  return <SettingsPageChromeProvider>{children}</SettingsPageChromeProvider>;
}

function HostAndProbe({ children }: { children: React.ReactNode }) {
  const { setActionsHost, override } = useSettingsPageChrome();
  return (
    <div>
      <div data-testid="host" ref={setActionsHost} />
      <div data-testid="override">{override ? "on" : "off"}</div>
      {children}
    </div>
  );
}

describe("settings page chrome", () => {
  it("portals SettingsPageActions into the registered host", () => {
    render(
      <Harness>
        <HostAndProbe>
          <SettingsPageActions>
            <button type="button">Refresh</button>
          </SettingsPageActions>
        </HostAndProbe>
      </Harness>,
    );
    const host = screen.getByTestId("host");
    expect(host).toContainElement(
      screen.getByRole("button", { name: "Refresh" }),
    );
  });

  it("renders nothing without a host or context", () => {
    render(
      <SettingsPageActions>
        <button type="button">Orphan</button>
      </SettingsPageActions>,
    );
    expect(screen.queryByRole("button", { name: "Orphan" })).toBeNull();
  });

  it("registers and clears the header override with the hook", async () => {
    function DrillIn() {
      const [on, setOn] = useState(true);
      useSettingsPageHeader(on ? { title: "Detail" } : null);
      useEffect(() => setOn(true), []);
      return (
        <button type="button" onClick={() => setOn(false)}>
          leave
        </button>
      );
    }
    render(
      <Harness>
        <HostAndProbe>
          <DrillIn />
        </HostAndProbe>
      </Harness>,
    );
    expect(screen.getByTestId("override").textContent).toBe("on");
    fireEvent.click(screen.getByRole("button", { name: "leave" }));
    await waitFor(() => {
      expect(screen.getByTestId("override").textContent).toBe("off");
    });
  });

  it("styles SettingsPageDescription as muted copy", () => {
    render(<SettingsPageDescription>About</SettingsPageDescription>);
    expect(screen.getByText("About")).toHaveClass("text-muted-foreground");
  });

  it("normalizes head action buttons to the compact h-7 spec", () => {
    render(
      <SettingsPageActionButton type="button">Refresh</SettingsPageActionButton>,
    );
    const button = screen.getByRole("button", { name: "Refresh" });
    expect(button).toHaveClass("h-7");
    expect(button).not.toHaveClass("h-8");
  });

  it("renders icon-mode action buttons as h-7 squares", () => {
    render(
      <SettingsPageActionButton aria-label="Refresh" icon type="button" />,
    );
    const button = screen.getByRole("button", { name: "Refresh" });
    expect(button).toHaveClass("h-7");
    expect(button).toHaveClass("w-7");
  });

  it("keeps variant and className passthrough on action buttons", () => {
    render(
      <SettingsPageActionButton
        className="text-destructive"
        type="button"
        variant="outline"
      >
        Reset
      </SettingsPageActionButton>,
    );
    const button = screen.getByRole("button", { name: "Reset" });
    expect(button).toHaveClass("text-destructive");
    expect(button).toHaveClass("border");
  });
});
