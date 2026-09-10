import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DIALOG_MOTION_MS } from "@amiba/ui/plugin";

import { AddConnectModal } from "../AddConnectModal";
import { createConnectorUIRegistry } from "../connector-ui-registry";
const presets = [{ id: "restricted", label: "Restricted", isDefault: true }];

describe("AddConnectModal", () => {
  it("opens the selected provider directly at the shared dialog width", () => {
    const registry = createConnectorUIRegistry();
    registry.register("lark", { component: () => <div>lark-screen</div> });
    render(
      <AddConnectModal
        adapter={{} as never}
        onCreated={vi.fn()}
        onOpenChange={vi.fn()}
        open
        presets={presets}
        providerId="lark"
        registry={registry}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("max-w-2xl", "duration-200");
    expect(screen.getByText("lark-screen")).toBeInTheDocument();
  });

  it("keeps the active screen intact until the close transition finishes", () => {
    vi.useFakeTimers();
    try {
      const registry = createConnectorUIRegistry();
      registry.register("lark", { component: () => <div>lark-screen</div> });
      const props = {
        adapter: {} as never,
        onCreated: vi.fn(),
        onOpenChange: vi.fn(),
        presets,
        registry,
      };
      const view = render(
        <AddConnectModal {...props} open providerId="lark" />,
      );
      expect(screen.getByText("lark-screen")).toBeInTheDocument();

      view.rerender(
        <AddConnectModal {...props} open={false} providerId={null} />,
      );
      view.rerender(<AddConnectModal {...props} open providerId="lark" />);
      expect(screen.getByText("lark-screen")).toBeInTheDocument();

      view.rerender(
        <AddConnectModal {...props} open={false} providerId={null} />,
      );
      act(() => vi.advanceTimersByTime(DIALOG_MOTION_MS));
      view.rerender(<AddConnectModal {...props} open providerId="lark" />);
      expect(screen.getByText("lark-screen")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes and notifies when the selected provider finishes", async () => {
    const registry = createConnectorUIRegistry();
    registry.register("lark", {
      component: ({ host }) => (
        <button type="button" onClick={() => host.done({ id: "c1" } as never)}>
          lark-done
        </button>
      ),
    });
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AddConnectModal
        adapter={{} as never}
        onCreated={onCreated}
        onOpenChange={onOpenChange}
        open
        presets={presets}
        providerId="lark"
        registry={registry}
      />,
    );
    await userEvent.click(await screen.findByText("lark-done"));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers close without an in-flow back step in settings", async () => {
    const registry = createConnectorUIRegistry();
    registry.register("lark", {
      component: ({ host }) => {
        expect(host.back).toBeUndefined();
        return (
          <button type="button" onClick={host.cancel}>
            close-wizard
          </button>
        );
      },
    });
    const onOpenChange = vi.fn();
    render(
      <AddConnectModal
        adapter={{} as never}
        onCreated={vi.fn()}
        onOpenChange={onOpenChange}
        open
        presets={presets}
        providerId="lark"
        registry={registry}
      />,
    );
    await userEvent.click(await screen.findByText("close-wizard"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // The mounted provider wizard draws its OWN header
  // close, so `DialogContent`'s default `absolute right-3 top-3` close would
  // sit right on top of it. `hideDefaultClose` is what keeps the corner
  // single-occupancy.
  it("does not add a second default close control", () => {
    const registry = createConnectorUIRegistry();
    registry.register("lark", { component: () => <div>lark-screen</div> });
    render(
      <AddConnectModal
        adapter={{} as never}
        onCreated={vi.fn()}
        onOpenChange={vi.fn()}
        open
        presets={presets}
        providerId="lark"
        registry={registry}
      />,
    );
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
  });

  it("renders nothing interactive when closed", () => {
    const registry = createConnectorUIRegistry();
    render(
      <AddConnectModal
        open={false}
        onOpenChange={vi.fn()}
        adapter={{} as never}
        registry={registry}
        providerId={null}
        presets={presets}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.queryByText("lark-screen")).not.toBeInTheDocument();
  });
});
