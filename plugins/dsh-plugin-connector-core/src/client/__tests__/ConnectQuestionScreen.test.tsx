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
  // The mount load is the screen's only data path; a rejection used to be
  // swallowed by `void`, leaving an empty chooser and an unhandled rejection.
  it("renders translated copy when the provider load fails, and leaves no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const p = {
        ...props(undefined),
        adapter: {
          listProviders: vi.fn(async () => {
            throw new Error("provider_not_found");
          }),
        } as never,
      };
      render(<ConnectQuestionScreen {...p} />);
      expect(
        await screen.findByText(
          /该 Provider 已不再安装。|That provider is no longer installed\./,
        ),
      ).toBeInTheDocument();
      // One macrotask is what Node needs to decide a rejection went unhandled.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("shows the owner's delivery error alongside a load failure", async () => {
    const p = {
      ...props(undefined),
      error: "respond-failed",
      adapter: {
        listProviders: vi.fn(async () => {
          throw new Error("connect_not_found");
        }),
      } as never,
    };
    render(<ConnectQuestionScreen {...p} />);
    expect(
      await screen.findByText(/该连接已不存在。|That connect no longer exists\./),
    ).toBeInTheDocument();
    expect(screen.getByText("respond-failed")).toBeInTheDocument();
  });

  // Spec: "the same chrome in the composer seat, sized like the plan-review
  // card". Everything docked above the composer — approvals, ClarifyBanner,
  // dock errors — shares ComposerDockSheet; the seat occupant renders INSIDE
  // it, never in a card of its own.
  it("renders inside the shared composer dock sheet", async () => {
    const { container } = render(<ConnectQuestionScreen {...props(undefined)} />);
    await screen.findByRole("heading");
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("amiba-dock-sheet");
    expect(root.querySelector("[data-wizard-frame]")).not.toBeNull();
    expect(container.querySelector("[data-connect-question-screen]")).toBeNull();
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
