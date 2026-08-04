import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ModelCatalogEntryCard } from "../ModelCatalogEntryCard";

describe("ModelCatalogEntryCard", () => {
  it("shows allowlisted supplemental capabilities and prefers provider values", () => {
    render(
      <ModelCatalogEntryCard
        entry={{
          id: "mixed-model",
          metadata: {
            context_window: 128_000,
            supports_reasoning: false,
            supports_vision: false,
          },
          supplemental: {
            source: "models.dev",
            metadata: {
              context_window: 1_000_000,
              input_modalities: ["text", "image", "pdf"],
              input_price_per_mtok: 1.25,
              model_family: "mixed-v2",
              reasoning: true,
              tool_call: true,
              vision: true,
            },
          },
        }}
        provider="example"
      />,
    );

    expect(screen.getByText("Tool calling")).toBeInTheDocument();
    expect(screen.getByText("PDF input")).toBeInTheDocument();
    expect(screen.getByText("128K")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument();
    expect(screen.queryByText("Vision")).not.toBeInTheDocument();
    expect(screen.queryByText("1M")).not.toBeInTheDocument();
    expect(screen.queryByText("$1.25/M")).not.toBeInTheDocument();
    expect(screen.queryByText("mixed-v2")).not.toBeInTheDocument();
  });

  it("keeps the information action available when no community profile matches", async () => {
    const user = userEvent.setup();
    render(
      <ModelCatalogEntryCard
        entry={{ id: "provider-only-model" }}
        provider="example"
      />,
    );

    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "View details for provider-only-model",
      }),
    );

    expect(
      await screen.findByRole("dialog", { name: "provider-only-model" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no community catalog entry matched this model/i),
    ).toBeInTheDocument();
  });
});
