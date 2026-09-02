import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConnectWizardChrome } from "../ConnectWizardChrome";
import { createConnectWizardRegistry } from "../wizard-registry";
import type { ConnectWizardHost } from "../wizard-registry";
import type { ConnectorProviderView } from "../../types";

const providers: ConnectorProviderView[] = [
  { id: "lark", name: "飞书 / Lark", description: "", supportsOnboarding: true },
  { id: "webhook", name: "Webhook", description: "", supportsOnboarding: false },
];
const presets = [
  { id: "restricted", label: "Restricted", isDefault: true },
  { id: "full", label: "Full", isDefault: false },
];

function fakeAdapter() {
  return { create: vi.fn(), beginOnboarding: vi.fn(), pollOnboarding: vi.fn(), cancelOnboarding: vi.fn() } as never;
}

// A fake provider body that echoes its host and exposes a submit button.
function makeBody(captured: { host?: ConnectWizardHost }) {
  return function Body({ host }: { host: ConnectWizardHost }) {
    captured.host = host;
    return (
      <button type="button" onClick={() => host.done({ id: "c1" } as never)}>
        submit
      </button>
    );
  };
}

describe("ConnectWizardChrome", () => {
  it("lists only providers that have a registered wizard", async () => {
    const registry = createConnectWizardRegistry();
    registry.register("lark", { component: makeBody({}) });
    render(
      <ConnectWizardChrome
        adapter={fakeAdapter()} registry={registry} providers={providers}
        presets={presets} onDone={vi.fn()} onCancel={vi.fn()}
      />,
    );
    expect(await screen.findByText("飞书 / Lark")).toBeInTheDocument();
    expect(screen.queryByText("Webhook")).not.toBeInTheDocument();
  });

  it("mounts the chosen provider body and flows live name + default preset into the host", async () => {
    const registry = createConnectWizardRegistry();
    const captured: { host?: ConnectWizardHost } = {};
    registry.register("lark", { component: makeBody(captured) });
    const onDone = vi.fn();
    render(
      <ConnectWizardChrome
        adapter={fakeAdapter()} registry={registry} providers={providers}
        presets={presets} onDone={onDone} onCancel={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByText("飞书 / Lark"));
    const name = await screen.findByLabelText(/连接名称|Connect name/);
    fireEvent.change(name, { target: { value: "Sales bot" } });
    expect(captured.host?.connectName).toBe("Sales bot");
    expect(captured.host?.agentPreset).toBe("restricted"); // isDefault
    expect(captured.host?.providerId).toBe("lark");
    await userEvent.click(screen.getByText("submit"));
    expect(onDone).toHaveBeenCalledWith({ id: "c1" });
  });

  it("skips the picker when initialProvider is a registered provider", async () => {
    const registry = createConnectWizardRegistry();
    registry.register("lark", { component: makeBody({}) });
    render(
      <ConnectWizardChrome
        adapter={fakeAdapter()} registry={registry} providers={providers}
        presets={presets} initialProvider="lark" onDone={vi.fn()} onCancel={vi.fn()}
      />,
    );
    expect(await screen.findByText("submit")).toBeInTheDocument();
    expect(screen.queryByText("Choose a platform")).not.toBeInTheDocument();
  });

  it("shows a no-wizard notice when a chosen provider has no entry", async () => {
    const registry = createConnectWizardRegistry();
    render(
      <ConnectWizardChrome
        adapter={fakeAdapter()} registry={registry} providers={providers}
        presets={presets} initialProvider="lark" onDone={vi.fn()} onCancel={vi.fn()}
      />,
    );
    expect(await screen.findByText(/no setup wizard|暂无接入向导/)).toBeInTheDocument();
  });
});
