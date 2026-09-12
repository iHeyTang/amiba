import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { PluginInventoryTabs } from "../PluginInventoryTabs";

function fixture() {
  return {
    list: vi.fn().mockResolvedValue({
      entries: [
        {
          entryId: "memory-entry",
          moduleName: "@amiba/memory",
          enabled: true,
          fiberPhase: "active",
        },
        {
          entryId: "tools-entry",
          moduleName: "@deepseek-ai/tools",
          enabled: true,
          fiberPhase: "active",
        },
      ],
    }),
  };
}

describe("contributed plugin tabs", () => {
  it("leaves the inventory unchanged until a plugin contributes and preserves its filter across registration, selection and removal", async () => {
    document.documentElement.lang = "en";
    const adapter = fixture();
    const renderTab = vi.fn(() => <p>External settings</p>);
    const { rerender } = render(
      <PluginInventoryTabs adapter={adapter} tabs={[]} renderTab={renderTab} />,
    );
    await screen.findByText("memory");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(renderTab).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Amiba/ }));
    expect(screen.queryByText("tools")).not.toBeInTheDocument();
    const originalInventoryDOM = screen
      .getByText("memory")
      .closest("[data-radix-scroll-area-viewport]")?.parentElement?.innerHTML;
    expect(originalInventoryDOM).toContain("memory");

    rerender(
      <PluginInventoryTabs
        adapter={adapter}
        tabs={[{ id: "external", label: "External" }]}
        renderTab={renderTab}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "External" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("External settings");
    expect(screen.getByRole("tab", { name: "External" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(
      screen.getByRole("tab", { name: "Plugin inventory" }),
    );
    expect(screen.getByText("memory")).toBeVisible();
    expect(screen.queryByText("tools")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "External" }));
    rerender(
      <PluginInventoryTabs adapter={adapter} tabs={[]} renderTab={renderTab} />,
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("memory")).toBeVisible();
    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("memory").closest("[data-radix-scroll-area-viewport]")
        ?.parentElement?.innerHTML,
    ).toBe(originalInventoryDOM);
  });

  it("supports keyboard tabs, disposes an unloaded panel and does not resurrect its selection", async () => {
    const adapter = fixture();
    const dispose = vi.fn();
    function Panel() {
      useEffect(() => dispose, []);
      return <p>Panel mounted</p>;
    }
    const renderTab = () => <Panel />;
    const tabs = [{ id: "amiba-inventory", label: "Extension" }];
    const { rerender } = render(
      <PluginInventoryTabs
        adapter={adapter}
        tabs={tabs}
        renderTab={renderTab}
      />,
    );
    await screen.findByText("memory");
    screen.getByRole("tab", { name: "Plugin inventory" }).focus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Extension" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel mounted");
    rerender(
      <PluginInventoryTabs adapter={adapter} tabs={[]} renderTab={renderTab} />,
    );
    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    rerender(
      <PluginInventoryTabs
        adapter={adapter}
        tabs={tabs}
        renderTab={renderTab}
      />,
    );
    expect(
      screen.getByRole("tab", { name: "Plugin inventory" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Panel mounted")).not.toBeInTheDocument();
  });
});
