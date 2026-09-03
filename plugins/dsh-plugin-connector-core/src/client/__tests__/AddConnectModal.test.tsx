import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AddConnectModal } from "../AddConnectModal";
import { createConnectWizardRegistry } from "../wizard-registry";
import type { ConnectorProviderView } from "../../types";

const providers: ConnectorProviderView[] = [
  { id: "lark", name: "飞书 / Lark", description: "", supportsOnboarding: false },
];
const presets = [{ id: "restricted", label: "Restricted", isDefault: true }];

describe("AddConnectModal", () => {
  it("shows the chooser, then the provider screen, and closes + notifies on done", async () => {
    const registry = createConnectWizardRegistry();
    registry.register("lark", { component: ({ host }) => <button type="button" onClick={() => host.done({ id: "c1" } as never)}>lark-done</button> });
    const onCreated = vi.fn(); const onOpenChange = vi.fn();
    render(<AddConnectModal adapter={{} as never} onCreated={onCreated} onOpenChange={onOpenChange} open presets={presets} providers={providers} registry={registry} />);
    await userEvent.click(await screen.findByRole("button", { name: /飞书 \/ Lark/ }));
    await userEvent.click(await screen.findByText("lark-done"));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("returns to the chooser on back", async () => {
    const registry = createConnectWizardRegistry();
    registry.register("lark", { component: ({ host }) => <button type="button" onClick={() => host.back()}>go-back</button> });
    render(<AddConnectModal adapter={{} as never} onCreated={vi.fn()} onOpenChange={vi.fn()} open presets={presets} providers={providers} registry={registry} />);
    await userEvent.click(await screen.findByRole("button", { name: /飞书 \/ Lark/ }));
    await userEvent.click(await screen.findByText("go-back"));
    expect(await screen.findByRole("button", { name: /飞书 \/ Lark/ })).toBeInTheDocument();
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
