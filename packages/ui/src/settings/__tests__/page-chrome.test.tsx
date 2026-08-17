import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

import {
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

  it("supports an explicit host getter across React roots", () => {
    const external = document.createElement("div");
    document.body.appendChild(external);
    render(
      <SettingsPageActions host={() => external}>
        <button type="button">Ext</button>
      </SettingsPageActions>,
    );
    expect(external.textContent).toContain("Ext");
    external.remove();
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
});
