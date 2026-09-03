import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProviderScreen } from "../ProviderScreen";
import { createConnectWizardRegistry } from "../wizard-registry";
import type { ConnectWizardHost } from "../wizard-registry";

const presets = [{ id: "restricted", label: "Restricted", isDefault: true }];

describe("ProviderScreen", () => {
  it("mounts the registered component with a full host", async () => {
    const registry = createConnectWizardRegistry();
    const captured: { host?: ConnectWizardHost } = {};
    registry.register("lark", { component: ({ host }) => { captured.host = host; return <button type="button" onClick={() => host.done({ id: "c1" } as never)}>done</button>; } });
    const onDone = vi.fn(); const onBack = vi.fn();
    render(<ProviderScreen adapter={{} as never} onBack={onBack} onCancel={vi.fn()} onDone={onDone} prefill={{ name: "飞书助手" }} presets={presets} providerId="lark" registry={registry} />);
    expect(captured.host?.providerId).toBe("lark");
    expect(captured.host?.presets).toEqual(presets);
    expect(captured.host?.prefill).toEqual({ name: "飞书助手" });
    expect(typeof captured.host?.kit.BasicsFields).toBe("function");
    captured.host?.back();
    expect(onBack).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByText("done"));
    expect(onDone).toHaveBeenCalledWith({ id: "c1" });
  });

  it("renders the no-wizard notice with change-platform and cancel when unregistered", async () => {
    const onBack = vi.fn(); const onCancel = vi.fn();
    render(<ProviderScreen adapter={{} as never} onBack={onBack} onCancel={onCancel} onDone={vi.fn()} presets={presets} providerId="lark" registry={createConnectWizardRegistry()} />);
    expect(screen.getByText(/no setup wizard|暂无接入向导/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /换个平台|Change platform/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
    // Two controls carry the "取消/Cancel" accessible name here: the header's
    // icon-only close button (same convention as LarkWizard/DingtalkWizard)
    // and the footer's own labelled Cancel button — pick the labelled one.
    const cancelButtons = screen.getAllByRole("button", { name: /取消|Cancel/ });
    const footerCancel = cancelButtons.find((b) => b.textContent?.trim())!;
    await userEvent.click(footerCancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
