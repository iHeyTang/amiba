import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMode: vi.fn(),
  setMode: vi.fn(),
}));

vi.mock("@amiba/core", () => ({
  getHermesApprovalMode: mocks.getMode,
  setHermesApprovalMode: mocks.setMode,
}));

vi.mock("@amiba/i18n", () => ({
  useT: () => ({
    t: (key: string) => key,
  }),
}));

import { ComposerApprovalModePicker } from "../ComposerApprovalModePicker";

describe("ComposerApprovalModePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMode.mockResolvedValue({
      ok: true,
      mode: "smart",
      profile: "researcher",
    });
    mocks.setMode.mockResolvedValue({
      ok: true,
      mode: "off",
      profile: "researcher",
      changed: true,
    });
  });

  it("shows the effective Profile approval mode in the composer", async () => {
    render(<ComposerApprovalModePicker profileId="researcher" />);

    const trigger = await screen.findByRole("button", {
      name: "sidepanel.approvalMode.label: sidepanel.approvalMode.smart",
    });
    expect(trigger).toHaveTextContent("sidepanel.approvalMode.smart");
    expect(trigger).toHaveClass("rounded-full");
    expect(trigger.querySelector(".lucide-chevron-down")).toBeNull();
    expect(mocks.getMode).toHaveBeenCalledWith("researcher");
  });

  it("switches the persistent Hermes mode from the anchored menu", async () => {
    const user = userEvent.setup();
    render(<ComposerApprovalModePicker profileId="researcher" />);

    await user.click(
      await screen.findByRole("button", {
        name: "sidepanel.approvalMode.label: sidepanel.approvalMode.smart",
      }),
    );
    const menu = screen.getByRole("menu", {
      name: "sidepanel.approvalMode.question",
    });
    expect(menu).toHaveAttribute("data-ui-overlay", "popover");
    expect(within(menu).queryByText(/Profile ·/)).not.toBeInTheDocument();
    expect(
      within(menu).getByText("sidepanel.approvalMode.question"),
    ).toHaveClass("text-muted-foreground");
    await user.click(
      within(menu).getByRole("menuitemradio", {
        name: /sidepanel\.approvalMode\.off/,
      }),
    );

    expect(mocks.setMode).toHaveBeenCalledWith("off", "researcher");
    expect(
      await screen.findByRole("button", {
        name: "sidepanel.approvalMode.label: sidepanel.approvalMode.off",
      }),
    ).toHaveClass("text-amber-600");
  });

  it("re-reads the authoritative profile config whenever the menu opens", async () => {
    const user = userEvent.setup();
    mocks.getMode
      .mockResolvedValueOnce({
        ok: true,
        mode: "smart",
        profile: "researcher",
      })
      .mockResolvedValueOnce({
        ok: true,
        mode: "manual",
        profile: "researcher",
      });

    render(<ComposerApprovalModePicker profileId="researcher" />);
    await user.click(
      await screen.findByRole("button", {
        name: "sidepanel.approvalMode.label: sidepanel.approvalMode.smart",
      }),
    );

    expect(mocks.getMode).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole("button", {
        name: "sidepanel.approvalMode.label: sidepanel.approvalMode.manual",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the trigger visually stable during the open-time refresh", async () => {
    const user = userEvent.setup();
    let finishRefresh!: (value: unknown) => void;
    mocks.getMode
      .mockResolvedValueOnce({
        ok: true,
        mode: "smart",
        profile: "researcher",
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve;
          }),
      );

    render(<ComposerApprovalModePicker profileId="researcher" />);
    const trigger = await screen.findByRole("button", {
      name: "sidepanel.approvalMode.label: sidepanel.approvalMode.smart",
    });

    await user.click(trigger);

    expect(trigger).toHaveTextContent("sidepanel.approvalMode.smart");
    expect(trigger.querySelector(".animate-spin")).toBeNull();

    finishRefresh({
      ok: true,
      mode: "manual",
      profile: "researcher",
    });
    expect(
      await screen.findByRole("button", {
        name: "sidepanel.approvalMode.label: sidepanel.approvalMode.manual",
      }),
    ).toBeInTheDocument();
  });

  it("uses the shared popover lifecycle across repeated open-close cycles", async () => {
    const user = userEvent.setup();
    render(<ComposerApprovalModePicker profileId="researcher" />);
    const trigger = await screen.findByRole("button", {
      name: "sidepanel.approvalMode.label: sidepanel.approvalMode.smart",
    });

    await user.click(trigger);
    const menu = screen.getByRole("menu", {
      name: "sidepanel.approvalMode.question",
    });
    expect(menu).toHaveAttribute("data-state", "open");
    expect(menu).toHaveAttribute("data-ui-overlay", "popover");

    await user.click(trigger);
    await waitFor(() =>
      expect(
        screen.queryByRole("menu", {
          name: "sidepanel.approvalMode.question",
        }),
      ).not.toBeInTheDocument(),
    );

    await user.click(trigger);
    expect(
      screen.getByRole("menu", {
        name: "sidepanel.approvalMode.question",
      }),
    ).toHaveAttribute("data-state", "open");
    await user.click(trigger);
    await waitFor(() =>
      expect(
        screen.queryByRole("menu", {
          name: "sidepanel.approvalMode.question",
        }),
      ).not.toBeInTheDocument(),
    );
  });

  it("refreshes a hidden renderer's stale approval failure when its host is shown", async () => {
    mocks.getMode.mockResolvedValueOnce({
      ok: false,
      error: "stale startup failure",
    });
    const { rerender } = render(
      <ComposerApprovalModePicker profileId="researcher" refreshKey={0} />,
    );

    expect(
      await screen.findByRole("button", {
        name: "sidepanel.approvalMode.label: sidepanel.approvalMode.label",
      }),
    ).toBeInTheDocument();

    rerender(
      <ComposerApprovalModePicker profileId="researcher" refreshKey={1} />,
    );

    expect(
      await screen.findByRole("button", {
        name: "sidepanel.approvalMode.label: sidepanel.approvalMode.smart",
      }),
    ).toBeInTheDocument();
    expect(mocks.getMode).toHaveBeenCalledTimes(2);
  });

  it("does not apply a completed save to a different active profile", async () => {
    const user = userEvent.setup();
    let finishOldSave!: (value: unknown) => void;
    mocks.setMode.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldSave = resolve;
        }),
    );
    mocks.getMode.mockImplementation(async (profile: string) => ({
      ok: true,
      mode: profile === "writer" ? "manual" : "smart",
      profile,
    }));

    const { rerender } = render(
      <ComposerApprovalModePicker profileId="researcher" />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "sidepanel.approvalMode.label: sidepanel.approvalMode.smart",
      }),
    );
    await user.click(
      screen.getByRole("menuitemradio", {
        name: /sidepanel\.approvalMode\.off/,
      }),
    );

    rerender(<ComposerApprovalModePicker profileId="writer" />);
    expect(
      await screen.findByRole("button", {
        name: "sidepanel.approvalMode.label: sidepanel.approvalMode.manual",
      }),
    ).toBeInTheDocument();

    finishOldSave({
      ok: true,
      mode: "off",
      profile: "researcher",
      changed: true,
    });
    expect(
      await screen.findByRole("button", {
        name: "sidepanel.approvalMode.label: sidepanel.approvalMode.manual",
      }),
    ).toBeInTheDocument();
  });
});
