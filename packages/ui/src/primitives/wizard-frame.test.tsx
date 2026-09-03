// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WizardFrame } from "./wizard-frame";

describe("WizardFrame", () => {
  it("renders header, tabs, body, footer hint and actions", async () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <WizardFrame
        icon={<span data-testid="icon" />}
        title="接入飞书"
        subtitle="用飞书 App 扫码授权"
        tabs={[
          { id: "scan", label: "扫码接入", active: true, onSelect: vi.fn() },
          { id: "manual", label: "手动填写凭证", active: false, onSelect },
        ]}
        hint="凭证只保存在本机"
        actions={<button type="button">添加</button>}
        onClose={onClose}
        closeLabel="关闭"
      >
        <p>body</p>
      </WizardFrame>,
    );
    expect(screen.getByRole("heading", { name: "接入飞书" })).toBeInTheDocument();
    expect(screen.getByText("用飞书 App 扫码授权")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "扫码接入" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "手动填写凭证" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.getByText("凭证只保存在本机")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits the tab row and footer when not given", () => {
    render(<WizardFrame title="T"><p>x</p></WizardFrame>);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  // Docked above the composer the frame sits inside ComposerDockSheet, whose
  // own bottom padding already clears the composer card. The frame hands its
  // vertical insets to the sheet through an ancestor variant (a provider
  // wizard renders the frame from its own bundle and cannot be told which
  // seat mounted it), so a docked wizard sits as tight as ClarifyBanner.
  it("hands its vertical insets to the composer dock sheet when docked", () => {
    const { container } = render(
      <WizardFrame title="T" actions={<button type="button">go</button>}>
        <p>x</p>
      </WizardFrame>,
    );
    expect(container.querySelector("header")).toHaveClass("[.amiba-dock-sheet_&]:pt-3");
    expect(container.querySelector("footer")).toHaveClass("[.amiba-dock-sheet_&]:pb-0");
  });
});
