import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProviderChooser } from "../ProviderChooser";
import { createConnectorUIRegistry } from "../connector-ui-registry";
import type { ConnectorProviderView } from "../../types";

const providers: ConnectorProviderView[] = [
  {
    id: "lark",
    name: "飞书 / Lark",
    description: "",
    supportsOnboarding: true,
  },
  {
    id: "webhook",
    name: "Webhook",
    description: "",
    supportsOnboarding: false,
  },
];

describe("ProviderChooser", () => {
  it("lists only registered providers and picks on click", async () => {
    const registry = createConnectorUIRegistry();
    registry.register("lark", {
      component: () => null,
      tagline: "扫码或填写凭证",
    });
    const onPick = vi.fn();
    render(
      <ProviderChooser
        onCancel={vi.fn()}
        onPick={onPick}
        providers={providers}
        registry={registry}
        subtitle="选择平台"
        title="添加连接"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "添加连接" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Webhook")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /飞书 \/ Lark/ }));
    expect(onPick).toHaveBeenCalledWith("lark");
    expect(
      screen.queryByRole("button", { name: /继续|Continue/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the hint in the footer and cancels", async () => {
    const onCancel = vi.fn();
    render(
      <ProviderChooser
        hint="没有你要的平台？"
        onCancel={onCancel}
        onPick={vi.fn()}
        providers={providers}
        registry={createConnectorUIRegistry()}
        title="添加连接"
      />,
    );
    expect(screen.getByText("没有你要的平台？")).toBeInTheDocument();
    // Two controls carry the "取消/Cancel" accessible name here: the header's
    // icon-only close button (same convention as LarkWizard/DingtalkWizard)
    // and the footer's own labelled Cancel button — pick the labelled one.
    const cancelButtons = screen.getAllByRole("button", {
      name: /取消|Cancel/,
    });
    const footerCancel = cancelButtons.find((b) => b.textContent?.trim())!;
    await userEvent.click(footerCancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows a registered provider logo without a second tile", () => {
    const registry = createConnectorUIRegistry();
    registry.register("lark", {
      component: () => null,
      icon: <img alt="" data-testid="lark-logo" />,
    });
    render(
      <ProviderChooser
        onCancel={vi.fn()}
        onPick={vi.fn()}
        providers={providers}
        registry={registry}
        title="添加连接"
      />,
    );

    const logoSlot = screen.getByTestId("lark-logo").parentElement;
    expect(logoSlot).toHaveAttribute("data-provider-logo", "");
    expect(logoSlot).toHaveClass("[&>img]:h-full", "[&>img]:w-full");
    expect(logoSlot).not.toHaveClass("border", "bg-muted/60", "rounded-[11px]");
  });
});
