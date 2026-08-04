import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  HermesMoaConfigResponse,
  HermesModelProviderView,
} from "@amiba/core";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "options.models.virtual.reference") {
        return `reference ${params?.number}`;
      }
      if (key === "options.models.config.pickerTitle") {
        return `picker ${params?.task}`;
      }
      if (key === "options.models.config.searchForTask") {
        return `search ${params?.task}`;
      }
      if (key === "options.models.virtual.copyName") {
        return `${params?.name} copy`;
      }
      if (key === "options.models.virtual.copyNameIndexed") {
        return `${params?.name} copy ${params?.number}`;
      }
      if (key === "options.models.virtual.presetActionsNamed") {
        return `manage ${params?.name}`;
      }
      if (key === "options.models.virtual.renamePresetNamed") {
        return `rename ${params?.name}`;
      }
      return key;
    },
  }),
}));

import { VirtualCapabilitiesPanel } from "../VirtualCapabilitiesPanel";

describe("VirtualCapabilitiesPanel", () => {
  it("marks a hidden aggregator model with an unavailable status dot", () => {
    const config: HermesMoaConfigResponse = {
      ok: true,
      configured: true,
      default_preset: "review",
      active_preset: "",
      presets: {
        review: {
          enabled: true,
          reference_models: [{ provider: "openrouter", model: "deepseek-r1" }],
          aggregator: {
            provider: "openrouter",
            model: "claude-3-7-sonnet",
          },
          reference_temperature: 0.6,
          aggregator_temperature: 0.4,
          max_tokens: 4096,
        },
      },
      reference_models: [],
      aggregator: { provider: "", model: "" },
      reference_temperature: 0.6,
      aggregator_temperature: 0.4,
      max_tokens: 4096,
      enabled: true,
    };
    const providers: HermesModelProviderView[] = [
      {
        id: "openrouter",
        label: "OpenRouter",
        kind: "remote",
        source: "config",
        authenticated: true,
        explicitlyConfigured: true,
        current: false,
        selectable: true,
        visible: true,
        models: [
          {
            id: "deepseek-r1",
            current: false,
            visible: true,
          },
          {
            id: "claude-3-7-sonnet",
            current: false,
            visible: false,
          },
        ],
      },
    ];

    render(
      <VirtualCapabilitiesPanel
        config={config}
        providers={providers}
        onSaved={vi.fn()}
      />,
    );

    const aggregatorRow = screen
      .getByText("options.models.virtual.aggregator")
      .closest("[data-moa-slot-row]");
    expect(aggregatorRow?.querySelector("[data-moa-slot-status]")).toHaveClass(
      "bg-amber-500",
    );
    expect(
      screen.getByText("options.models.virtual.unavailableHint"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("options.models.virtual.defaultPreset"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "options.models.virtual.setDefault",
      }),
    ).not.toBeInTheDocument();
  });

  it("does not treat an intentionally disabled reference as degraded", () => {
    render(
      <VirtualCapabilitiesPanel
        config={{
          ok: true,
          configured: true,
          default_preset: "review",
          active_preset: "",
          presets: {
            review: {
              enabled: true,
              reference_models: [
                {
                  provider: "missing",
                  model: "offline-reference",
                  enabled: false,
                },
              ],
              aggregator: {
                provider: "openrouter",
                model: "aggregator",
              },
              reference_temperature: null,
              aggregator_temperature: null,
              max_tokens: 4096,
            },
          },
          reference_models: [],
          aggregator: { provider: "", model: "" },
          reference_temperature: null,
          aggregator_temperature: null,
          max_tokens: 4096,
          enabled: true,
        }}
        providers={[
          {
            id: "openrouter",
            label: "OpenRouter",
            kind: "remote",
            source: "config",
            authenticated: true,
            explicitlyConfigured: true,
            current: false,
            selectable: true,
            visible: true,
            models: [{ id: "aggregator", current: false, visible: true }],
          },
        ]}
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByText("options.models.virtual.status.ready"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("options.models.virtual.degradedHint"),
    ).not.toBeInTheDocument();
  });

  it("shows MoA as a dependency pipeline rather than a service provider", async () => {
    const user = userEvent.setup();
    render(
      <VirtualCapabilitiesPanel
        config={{
          ok: true,
          configured: true,
          default_preset: "review",
          active_preset: "",
          presets: {
            review: {
              enabled: true,
              reference_models: [
                { provider: "openrouter", model: "deepseek-r1" },
              ],
              aggregator: {
                provider: "openrouter",
                model: "claude-3-7-sonnet",
              },
              reference_temperature: 0.6,
              aggregator_temperature: 0.4,
              max_tokens: 4096,
            },
            fast: {
              enabled: false,
              reference_models: [
                { provider: "openrouter", model: "deepseek-r1" },
              ],
              aggregator: {
                provider: "openrouter",
                model: "claude-3-7-sonnet",
              },
              reference_temperature: 0.4,
              aggregator_temperature: 0.2,
              max_tokens: 2048,
            },
          },
          reference_models: [],
          aggregator: { provider: "", model: "" },
          reference_temperature: 0.6,
          aggregator_temperature: 0.4,
          max_tokens: 4096,
          enabled: true,
        }}
        providers={[
          {
            id: "openrouter",
            label: "OpenRouter",
            kind: "remote",
            source: "config",
            authenticated: true,
            explicitlyConfigured: true,
            current: false,
            selectable: true,
            visible: true,
            models: [
              {
                id: "deepseek-r1",
                description: "DeepSeek R1",
                current: false,
                visible: true,
              },
              {
                id: "claude-3-7-sonnet",
                description: "Claude 3.7 Sonnet",
                current: false,
                visible: true,
              },
            ],
          },
        ]}
        onSaved={vi.fn()}
      />,
    );

    const presetSidebar = document.querySelector("[data-moa-preset-sidebar]");
    expect(presetSidebar).toBeInTheDocument();
    expect(presetSidebar).toHaveClass("w-52", "border-r");
    expect(
      screen.getByRole("navigation", {
        name: "options.models.virtual.preset",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("options.models.virtual.pipelineTitle"),
    ).toBeInTheDocument();
    expect(screen.getByText("reference 1")).toBeInTheDocument();
    expect(
      screen.getByText("options.models.virtual.aggregator"),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-model-icon="deepseek"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-model-icon="claude"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("DeepSeek R1")).toBeInTheDocument();
    expect(screen.getByText("Claude 3.7 Sonnet")).toBeInTheDocument();

    const savePreset = screen.getByRole("button", {
      name: "options.models.virtual.save",
    });
    const presetSwitch = screen.getByRole("switch", {
      name: "options.models.virtual.enabled",
    });
    const presetActions = document.querySelector("[data-moa-preset-actions]");
    const presetToggle = document.querySelector("[data-moa-preset-toggle]");
    const otherPreset = screen.getByRole("button", { name: "fast" });
    expect(
      screen.getAllByText("options.models.virtual.defaultPreset"),
    ).toHaveLength(2);
    await user.click(otherPreset);
    expect(
      screen.getByRole("button", {
        name: "options.models.virtual.setDefault",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^review/ }));
    expect(presetToggle).toContainElement(presetSwitch);
    expect(presetActions).not.toContainElement(presetSwitch);
    expect(presetActions).toContainElement(savePreset);
    expect(
      within(presetActions as HTMLElement).getAllByRole("button"),
    ).toHaveLength(1);
    expect(savePreset).toHaveClass("h-8", "rounded-lg");
    expect(savePreset).toBeDisabled();
    expect(savePreset.closest("[data-moa-preset-toolbar]")).toBeNull();
    expect(presetActions?.parentElement).toHaveClass("space-y-4");
    expect(presetActions).toHaveClass("items-center", "pt-1");
    expect(presetActions).not.toHaveClass("justify-end", "bg-muted/[0.12]");
    expect(otherPreset).toBeEnabled();
    expect(document.querySelector("[data-moa-pipeline]")).toHaveClass(
      "rounded-xl",
    );
    expect(
      document.querySelector("[data-moa-add-reference-row]"),
    ).not.toHaveClass("border-t");
    expect(
      document.querySelector("[data-moa-add-reference-row]"),
    ).not.toHaveClass("bg-muted/10");
    expect(document.querySelector("[data-moa-add-reference-row]")).toHaveClass(
      "grid",
      "grid-cols-[8rem_minmax(0,1fr)_auto]",
      "border-b",
    );
    expect(document.querySelector("[data-moa-add-reference-icon]")).toHaveClass(
      "w-1.5",
    );
    expect(
      document.querySelector("[data-moa-add-reference-label]"),
    ).not.toHaveClass("pl-11");
    const modelSlots = document.querySelectorAll("[data-moa-model-slot]");
    const slotRows = document.querySelectorAll("[data-moa-slot-row]");
    expect(modelSlots).toHaveLength(2);
    expect(slotRows).toHaveLength(2);
    modelSlots.forEach((modelSlot) =>
      expect(modelSlot).toHaveClass("rounded-xl"),
    );
    modelSlots.forEach((modelSlot) =>
      expect(modelSlot).not.toHaveClass("border"),
    );
    slotRows.forEach((slotRow) =>
      expect(slotRow.className).not.toContain("bg-primary"),
    );
    expect(
      screen.queryByText("options.models.virtual.maxTokens"),
    ).not.toBeInTheDocument();

    const presetMenuTrigger = screen.getByRole("button", {
      name: "manage review",
    });
    expect(presetMenuTrigger).toHaveClass(
      "absolute",
      "w-11",
      "justify-end",
      "bg-secondary",
      "opacity-0",
      "group-hover/preset:opacity-100",
    );
    expect(presetMenuTrigger).not.toHaveClass("bg-secondary/95");
    await user.click(presetMenuTrigger);
    expect(presetMenuTrigger).toHaveAttribute("data-state", "open");
    const presetMenu = screen.getByRole("menu", {
      name: "options.models.virtual.presetActions",
    });
    const copyPreset = within(presetMenu).getByRole("menuitem", {
      name: "options.models.virtual.copyPreset",
    });
    expect(
      within(presetMenu).getByRole("menuitem", {
        name: "options.models.virtual.deletePreset",
      }),
    ).toBeEnabled();
    await user.click(copyPreset);
    expect(
      screen.getByRole("button", { name: "rename review copy" }),
    ).toBeInTheDocument();
    expect(savePreset).toBeEnabled();
    expect(otherPreset).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "rename review copy" }),
    );
    const presetNameInput = screen.getByRole("textbox", {
      name: "options.models.virtual.renamePreset",
    });
    await user.clear(presetNameInput);
    await user.type(presetNameInput, "review custom{Enter}");
    expect(
      screen.getByRole("button", { name: "rename review custom" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "picker reference 1" }),
    );
    const picker = await screen.findByRole("dialog", {
      name: "picker reference 1",
    });
    expect(picker).toHaveAttribute("data-model-picker-modal", "true");
    await user.click(
      within(picker).getByRole("option", { name: /Claude 3.7 Sonnet/ }),
    );
    expect(
      within(
        screen.getByRole("button", { name: "picker reference 1" }),
      ).getByText("Claude 3.7 Sonnet"),
    ).toBeInTheDocument();

    await user.click(screen.getByText("options.models.virtual.advancedTitle"));
    expect(
      screen.getByText("options.models.virtual.referenceTemperatureHint"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("options.models.virtual.aggregatorTemperatureHint"),
    ).toBeInTheDocument();

    await user.click(presetSwitch);

    expect(savePreset).toBeEnabled();
    expect(otherPreset).toBeDisabled();
    expect(
      screen.getByLabelText("options.models.virtual.unsaved"),
    ).toBeInTheDocument();
    expect(
      document.querySelector("[data-moa-preset-unsaved]")?.parentElement,
    ).toHaveClass("flex-1", "items-center");
    expect(
      screen.queryByRole("button", { name: "manage review custom" }),
    ).not.toBeInTheDocument();
  });
});
