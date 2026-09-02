import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AddConnectModal } from "../AddConnectModal";
import { createConnectWizardRegistry } from "../wizard-registry";
import type { ConnectWizardHost } from "../wizard-registry";
import type { ConnectorProviderView } from "../../types";

const providers: ConnectorProviderView[] = [
  { id: "lark", name: "飞书 / Lark", description: "", supportsOnboarding: false },
];
const presets = [{ id: "restricted", label: "Restricted", isDefault: true }];

describe("AddConnectModal", () => {
  it("renders the chrome when open and fires onCreated when a body completes", async () => {
    const registry = createConnectWizardRegistry();
    registry.register("lark", {
      component: ({ host }: { host: ConnectWizardHost }) => (
        <button type="button" onClick={() => host.done({ id: "c1" } as never)}>done</button>
      ),
    });
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AddConnectModal
        open onOpenChange={onOpenChange} adapter={{} as never}
        registry={registry} providers={providers} presets={presets} onCreated={onCreated}
      />,
    );
    await userEvent.click(await screen.findByText("飞书 / Lark"));
    await userEvent.click(await screen.findByText("done"));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing interactive when closed", () => {
    const registry = createConnectWizardRegistry();
    render(
      <AddConnectModal
        open={false} onOpenChange={vi.fn()} adapter={{} as never}
        registry={registry} providers={providers} presets={presets} onCreated={vi.fn()}
      />,
    );
    expect(screen.queryByText("飞书 / Lark")).not.toBeInTheDocument();
  });
});
