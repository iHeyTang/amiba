import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

import { DshSettingsStatus } from "../DshSettingsStatus";

const status = vi.fn();

describe("DshSettingsStatus visual contract", () => {
  beforeEach(() => {
    status.mockResolvedValue({
      runtime: "dsh",
      healthy: true,
      state: "running",
      version: "0.1.0-rc.6",
      commit: "47f9438",
      nodeVersion: "22.22.0",
      pid: 1234,
      startedAt: Date.now() - 10_000,
      sessionCount: 3,
      liveSessionCount: 1,
      paths: {
        home: "/tmp/dsh",
        agentsHome: "/tmp/dsh/agents",
        runtimeDir: "/app/resources/dsh-runtime",
      },
    });
    setPlatform({
      storage: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
        watch: vi.fn(() => () => {}),
      },
      agentDiagnostics: {
        status,
        restart: vi.fn(),
        logs: vi.fn(),
      },
    } as unknown as PlatformAdapter);
  });

  it("retains health hierarchy, runtime rows, and collapsible storage paths", async () => {
    render(<DshSettingsStatus />);

    expect(await screen.findByText("DeepSeek Harness is ready")).toBeVisible();
    expect(screen.getByText("Managed runtime")).toBeVisible();
    expect(screen.getByText("0.1.0-rc.6")).toBeVisible();
    expect(screen.getByText("Isolated storage")).toBeVisible();
    expect(screen.getAllByText("/tmp/dsh")[0]).toBeVisible();
    expect(status).toHaveBeenCalled();
  });

  it("renders the page description in place of an in-pane header", async () => {
    render(<DshSettingsStatus />);

    expect(
      await screen.findByText(
        "Health and identity of Amiba's immutable managed DSH runtime.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "DeepSeek Harness status" }),
    ).toBeNull();
  });
});
