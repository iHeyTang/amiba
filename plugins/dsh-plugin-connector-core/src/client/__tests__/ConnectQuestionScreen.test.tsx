import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConnectQuestionScreen } from "../ConnectQuestionScreen";
import { createConnectWizardRegistry } from "../wizard-registry";

const providers = [{ id: "lark", name: "飞书 / Lark", description: "", supportsOnboarding: true }];
const presets = [{ id: "restricted", label: "Restricted", isDefault: true }];
function props(detail: string | undefined, registry = createConnectWizardRegistry()) {
  return {
    request: { requestId: "r1", questions: [{ id: "amiba.connect-wizard", question: "在下方完成平台接入", ...(detail ? { detail } : {}) }] },
    inFlight: false, error: null, respond: vi.fn(), cancel: vi.fn(),
    adapter: { listProviders: vi.fn(async () => providers) } as never,
    registry, loadPresets: vi.fn(async () => presets),
  };
}

describe("ConnectQuestionScreen", () => {
  it("opens the prefilled provider's screen and answers with only the connect id", async () => {
    const registry = createConnectWizardRegistry();
    registry.register("lark", { component: ({ host }) => <button type="button" onClick={() => host.done({ id: "c1", provider: "lark" } as never)}>finish:{host.prefill?.name}</button> });
    const p = props(JSON.stringify({ provider: "lark", name: "飞书助手" }), registry);
    render(<ConnectQuestionScreen {...p} />);
    await userEvent.click(await screen.findByText("finish:飞书助手"));
    expect(p.respond).toHaveBeenCalledWith([{ id: "amiba.connect-wizard", selected: [], custom: "c1" }]);
  });
  it("shows the chooser when no provider was prefilled, then the picked provider's screen", async () => {
    const registry = createConnectWizardRegistry();
    registry.register("lark", { component: () => <div>lark-screen</div> });
    render(<ConnectQuestionScreen {...props(undefined, registry)} />);
    await userEvent.click(await screen.findByRole("button", { name: /飞书 \/ Lark/ }));
    expect(await screen.findByText("lark-screen")).toBeInTheDocument();
  });
  it("cancel closes the wait", async () => {
    const p = props(undefined);
    render(<ConnectQuestionScreen {...p} />);
    // Two controls carry the "取消/Cancel" accessible name in the chooser —
    // WizardFrame's header icon-only close and the footer's labelled Cancel
    // (both wired to `cancel`). Same disambiguation the sibling
    // ProviderChooser test documents: pick the labelled one.
    const cancelButtons = await screen.findAllByRole("button", { name: /取消|Cancel/ });
    const footerCancel = cancelButtons.find((b) => b.textContent?.trim())!;
    await userEvent.click(footerCancel);
    expect(p.cancel).toHaveBeenCalledTimes(1);
  });
});
