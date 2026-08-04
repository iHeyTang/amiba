import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ModelDisplayPanel } from "../ModelDisplayPanel";

describe("ModelDisplayPanel", () => {
  it("makes ambient credential discovery explicit and opt-in", async () => {
    const user = userEvent.setup();
    const onProviderVisibilityChange = vi.fn();
    const onConfigureProvider = vi.fn();

    render(
      <ModelDisplayPanel
        providers={[
          {
            id: "copilot",
            label: "GitHub Copilot",
            kind: "remote",
            source: "detected-credentials",
            authenticated: true,
            explicitlyConfigured: false,
            current: false,
            selectable: true,
            visible: false,
            models: [
              {
                id: "gpt-5-mini",
                current: false,
                visible: true,
                metadata: { fast_mode: true },
                supplemental: {
                  source: "models.dev",
                  description: "GPT-5 mini",
                  metadata: {
                    context_window: 1_000_000,
                    max_output_tokens: 128_000,
                    reasoning: true,
                    tool_call: true,
                    structured_output: true,
                    input_modalities: ["text", "image", "pdf"],
                    output_modalities: ["text"],
                    model_family: "gpt-5",
                  },
                },
              },
            ],
          },
        ]}
        onConfigureProvider={onConfigureProvider}
        onProviderVisibilityChange={onProviderVisibilityChange}
        onModelVisibilityChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Credential detected")).toBeInTheDocument();
    const providerSection = screen
      .getByText("Service providers")
      .closest("section");
    expect(providerSection).toHaveClass("space-y-4");
    expect(
      providerSection?.querySelector("[data-model-settings-surface]"),
    ).toHaveClass("rounded-xl", "border-border/70");
    expect(
      screen.queryByText(/service access has not been verified/i),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-model-icon="githubcopilot"]'),
    ).toBeInTheDocument();
    const configureButton = screen.getByRole("button", {
      name: "Configure GitHub Copilot",
    });
    expect(configureButton).toHaveClass("rounded-full");
    await user.click(configureButton);
    expect(onConfigureProvider).toHaveBeenCalledWith("copilot");

    await user.click(
      screen.getByRole("button", {
        name: /GitHub Copilot/i,
        expanded: false,
      }),
    );
    expect(
      document.querySelector('[data-model-icon="openai"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-model-info-card="gpt-5-mini"]'),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-model-row="gpt-5-mini"]')).toHaveClass(
      "pl-8",
    );
    expect(
      document.querySelector('[data-model-info-card="gpt-5-mini"]'),
    ).toHaveClass("border-0");
    const modelIdentity = document
      .querySelector('[data-model-info-card="gpt-5-mini"]')
      ?.querySelector("[data-model-identity-line]");
    expect(
      modelIdentity?.querySelector("[data-model-primary-name]"),
    ).toHaveTextContent("GPT-5 mini");
    expect(modelIdentity?.querySelector("[data-model-id]")).toHaveTextContent(
      "gpt-5-mini",
    );
    expect(screen.queryByText("Fast mode")).not.toBeInTheDocument();
    expect(
      screen.getByText("1M").closest("[data-model-metric]"),
    ).toHaveAttribute("data-model-metric", "context");
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("Tool calling")).toBeInTheDocument();
    expect(screen.getByText("Vision")).toBeInTheDocument();
    expect(screen.queryByText("Structured output")).not.toBeInTheDocument();
    expect(screen.getByText("PDF input")).toBeInTheDocument();
    expect(screen.queryByText("Input modalities")).not.toBeInTheDocument();

    const toggle = screen.getByRole("switch", {
      name: "Show GitHub Copilot in model menus",
    });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(onProviderVisibilityChange).toHaveBeenCalledWith("copilot", true);

    const detailsButton = screen.getByRole("button", {
      name: "View details for gpt-5-mini",
    });
    expect(detailsButton).toHaveClass("rounded-full");
    await user.click(detailsButton);
    const detailsDialog = await screen.findByRole("dialog", {
      name: "GPT-5 mini",
    });
    expect(detailsDialog).toBeInTheDocument();
    expect(within(detailsDialog).getByText("1M")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("Reasoning")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("Tool calling")).toBeInTheDocument();
    expect(
      within(detailsDialog).getByText("Structured output"),
    ).toBeInTheDocument();
    expect(within(detailsDialog).getByText("Fast mode")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("PDF input")).toBeInTheDocument();
    expect(
      within(detailsDialog).queryByText("Input modalities"),
    ).not.toBeInTheDocument();
    const referenceNote = screen.getByText(
      "Model information references models.dev.",
    );
    expect(referenceNote.closest("footer")).toBeInTheDocument();
  });
});
