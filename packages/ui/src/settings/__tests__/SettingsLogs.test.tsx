import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  getActionStatus: vi.fn(),
  getHermesLogs: vi.fn(),
  getHermesStatus: vi.fn(),
  restartHermesGateway: vi.fn(),
  updateHermes: vi.fn(),
}));

vi.mock("@amiba/core", () => core);

import { SettingsLogs } from "../SettingsLogs";
import { SettingsStatus } from "../SettingsStatus";

describe("Hermes update logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    core.getActionStatus.mockImplementation(async (name: string) => ({
      ok: true,
      name,
      running: false,
      exit_code: 0,
      pid: 42,
      lines:
        name === "hermes-update"
          ? ["downloading Hermes update", "Hermes update complete"]
          : ["gateway restarted"],
    }));
    core.getHermesLogs.mockResolvedValue({ ok: true, lines: [] });
    core.getHermesStatus.mockResolvedValue({
      ok: true,
      version: "1.0.0",
      gateway_running: true,
      update_check: { status: "up_to_date", commits_behind: 0 },
    });
  });

  it("loads updater output in the central Logs pane", async () => {
    render(<SettingsLogs source="hermes-update" />);

    expect(
      await screen.findByText("Hermes update complete"),
    ).toBeInTheDocument();
    expect(core.getActionStatus).toHaveBeenCalledWith("hermes-update", 100);
    expect(core.getHermesLogs).not.toHaveBeenCalled();
    expect(screen.queryByText("Level")).not.toBeInTheDocument();
    expect(screen.getByText("exit 0")).toBeInTheDocument();
    expect(
      screen
        .getByText("Hermes update complete")
        .closest('[data-selection="text"]'),
    ).toHaveAttribute("data-selection", "text");
  });

  it("keeps update output off Status and opens Logs through the shortcut", async () => {
    const onViewUpdateLogs = vi.fn();
    render(<SettingsStatus onViewUpdateLogs={onViewUpdateLogs} />);

    const shortcut = await screen.findByRole("button", {
      name: "View update logs",
    });
    expect(screen.getByText("All systems operational")).toBeInTheDocument();
    expect(screen.getByText("Hermes runtime")).toBeInTheDocument();
    expect(screen.getAllByText("Local gateway").length).toBeGreaterThan(0);
    await userEvent.click(shortcut);

    expect(onViewUpdateLogs).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(core.getActionStatus).toHaveBeenCalledWith(
        "hermes-update",
        200,
        expect.any(AbortSignal),
      ),
    );
    expect(
      screen.queryByText("Hermes update complete"),
    ).not.toBeInTheDocument();
  });

  it("keeps lifecycle actions next to the status they affect", async () => {
    render(<SettingsStatus onViewUpdateLogs={vi.fn()} />);

    const runtimeCard = (await screen.findByText("Hermes runtime")).closest(
      "section",
    );
    const gatewayCard = screen.getByText("Local gateway").closest("section");

    expect(runtimeCard).not.toBeNull();
    expect(gatewayCard).not.toBeNull();
    expect(runtimeCard).not.toBe(gatewayCard);
    expect(runtimeCard!.parentElement).toBe(gatewayCard!.parentElement);
    expect(
      within(runtimeCard!.parentElement!).getByRole("button", {
        name: "Refresh",
      }),
    ).toBeInTheDocument();
    expect(
      within(runtimeCard!).getByRole("button", { name: "Update Hermes" }),
    ).toBeInTheDocument();
    expect(
      within(runtimeCard!).getByRole("button", { name: "View update logs" }),
    ).toBeInTheDocument();
    expect(
      within(gatewayCard!).getByRole("button", { name: "Restart gateway" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Maintenance")).not.toBeInTheDocument();
    expect(screen.queryByText("gateway restarted")).not.toBeInTheDocument();
  });

  it("surfaces an offline gateway as the primary health conclusion", async () => {
    core.getHermesStatus.mockResolvedValue({
      ok: true,
      version: "1.0.0",
      gateway_running: false,
      gateway_state: "stopped",
      update_check: { status: "up_to_date", commits_behind: 0 },
    });

    render(<SettingsStatus onViewUpdateLogs={vi.fn()} />);

    expect(await screen.findByText("Gateway is offline")).toBeInTheDocument();
    expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
  });

  it("surfaces the Hermes minimum-version requirement with an update path", async () => {
    core.getHermesStatus.mockResolvedValue({
      ok: true,
      version: "0.16.9",
      gateway_running: true,
      hermes_version_mismatch: {
        installed: "0.16.9",
        required: "0.19.0",
        reason: "unsupported",
      },
      update_check: { status: "behind", commits_behind: null },
    });

    render(<SettingsStatus onViewUpdateLogs={vi.fn()} />);

    expect(
      await screen.findByText("Hermes update required"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/requires Hermes 0\.19\.0 or newer/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Update Hermes" }),
    ).toBeInTheDocument();
  });
});
