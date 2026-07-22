import { render, screen, waitFor } from "@testing-library/react";
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
  });

  it("keeps update output off Status and opens Logs through the shortcut", async () => {
    const onViewUpdateLogs = vi.fn();
    render(<SettingsStatus onViewUpdateLogs={onViewUpdateLogs} />);

    const shortcut = await screen.findByRole("button", {
      name: "View update logs",
    });
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
});
