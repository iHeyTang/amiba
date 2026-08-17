import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

import { DshSettingsLogs } from "../DshSettingsLogs";
import { SettingsPageScaffold } from "../SettingsPageScaffold";

const logs = vi.fn();

describe("DshSettingsLogs visual contract", () => {
  beforeEach(() => {
    logs.mockResolvedValue({ entries: [] });
    setPlatform({
      storage: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
        watch: vi.fn(() => () => {}),
      },
      agentDiagnostics: {
        status: vi.fn(),
        restart: vi.fn(),
        logs,
      },
    } as unknown as PlatformAdapter);
  });

  it("portals the auto-refresh switch and refresh button into the scaffold head", async () => {
    render(
      <SettingsPageScaffold title="Logs">
        <DshSettingsLogs />
      </SettingsPageScaffold>,
    );

    expect(await screen.findByText("dsh-runtime.log")).toBeVisible();

    const host = document.querySelector("[data-settings-page-actions]");
    expect(host?.textContent).toContain("Refresh");
    expect(host?.querySelector("#dsh-logs-auto-refresh")).not.toBeNull();
    expect(logs).toHaveBeenCalled();
  });
});
