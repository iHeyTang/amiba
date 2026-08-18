import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPreset: vi.fn(),
  setPreset: vi.fn(),
}));

vi.mock("@amiba/app-runtime/core", () => ({
  getPermissionPreset: mocks.getPreset,
  setPermissionPreset: mocks.setPreset,
}));

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { ComposerApprovalModePicker } from "../ComposerApprovalModePicker";

const options = [
  { value: "read-only", name: "read-only" },
  { value: "workspace-write", name: "workspace-write" },
  { value: "danger-full-access", name: "danger-full-access" },
];

function permission(
  preset = "workspace-write",
  scope: "default" | "session" = "session",
) {
  return {
    ok: true,
    preset,
    options,
    scope,
    writable: true,
    ...(scope === "default" ? { revision: 2 } : {}),
  } as const;
}

describe("ComposerApprovalModePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPreset.mockResolvedValue(permission());
    mocks.setPreset.mockResolvedValue(permission("read-only"));
  });

  it("shows the DSH session permission preset without changing pill styling", async () => {
    render(<ComposerApprovalModePicker sessionId="session-1" />);

    const trigger = await screen.findByRole("button", {
      name: "sidepanel.approvalMode.label: sidepanel.permissionPreset.workspaceWrite",
    });
    expect(trigger).toHaveClass("rounded-full");
    expect(mocks.getPreset).toHaveBeenCalledWith("session-1");
  });

  it("switches a safe preset through the runtime permission API", async () => {
    const user = userEvent.setup();
    render(<ComposerApprovalModePicker sessionId="session-1" />);

    await user.click(
      await screen.findByRole("button", {
        name: /sidepanel\.permissionPreset\.workspaceWrite/u,
      }),
    );
    const menu = screen.getByRole("menu", {
      name: "sidepanel.permissionPreset.question",
    });
    await user.click(
      within(menu).getByRole("menuitemradio", {
        name: /sidepanel\.permissionPreset\.readOnly/u,
      }),
    );

    expect(mocks.setPreset).toHaveBeenCalledWith(
      "read-only",
      "session-1",
      undefined,
    );
  });

  it("requires explicit acknowledgement before enabling full access", async () => {
    const user = userEvent.setup();
    mocks.setPreset.mockResolvedValue(permission("danger-full-access"));
    render(<ComposerApprovalModePicker sessionId="session-1" />);
    await user.click(
      await screen.findByRole("button", {
        name: /sidepanel\.permissionPreset\.workspaceWrite/u,
      }),
    );
    await user.click(
      screen.getByRole("menuitemradio", {
        name: /sidepanel\.permissionPreset\.fullAccess/u,
      }),
    );

    const enable = screen.getByRole("button", {
      name: "sidepanel.permissionPreset.enableFullAccess",
    });
    expect(enable).toBeDisabled();
    expect(mocks.setPreset).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(enable);
    expect(mocks.setPreset).toHaveBeenCalledWith(
      "danger-full-access",
      "session-1",
      undefined,
    );
  });

  it("uses the DSH future-session default when a task is not materialized", async () => {
    mocks.getPreset.mockResolvedValue(permission("read-only", "default"));
    render(<ComposerApprovalModePicker />);
    await screen.findByRole("button", {
      name: /sidepanel\.permissionPreset\.readOnly/u,
    });
    expect(mocks.getPreset).toHaveBeenCalledWith(undefined);
  });

  it("revalidates the authoritative projection whenever the menu opens", async () => {
    const user = userEvent.setup();
    mocks.getPreset
      .mockResolvedValueOnce(permission("workspace-write"))
      .mockResolvedValueOnce(permission("read-only"));
    render(<ComposerApprovalModePicker sessionId="session-1" />);
    await user.click(
      await screen.findByRole("button", {
        name: /sidepanel\.permissionPreset\.workspaceWrite/u,
      }),
    );
    await waitFor(() => expect(mocks.getPreset).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", {
        name: /sidepanel\.permissionPreset\.readOnly/u,
      }),
    ).toBeInTheDocument();
  });
});
