import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModelInfoCard } from "../ModelInfoCard";

describe("ModelInfoCard", () => {
  it("groups limits, prices, capabilities, modalities, and catalog details", () => {
    render(
      <ModelInfoCard
        metadata={{
          context_window: 1_000_000,
          max_input_tokens: 900_000,
          max_output_tokens: 100_000,
          input_price_per_mtok: 1.25,
          output_price_per_mtok: 4.5,
          cache_read_price_per_mtok: 0.25,
          reasoning: true,
          tool_call: true,
          vision: true,
          temperature: true,
          structured_output: true,
          open_weights: true,
          fast_mode: true,
          interleaved_reasoning: true,
          input_modalities: ["text", "image", "pdf", "audio"],
          output_modalities: ["text", "image", "audio"],
          model_family: "example-v2",
          knowledge_cutoff: "2026-01",
          release_date: "2026-02-03",
          model_status: "beta",
          parameters: "120B",
          capabilities_source: "models.dev",
        }}
        model="example-reasoner"
        provider="example"
        showIdentity={false}
      />,
    );

    expect(screen.getByText("1M")).toBeInTheDocument();
    expect(screen.getByText("900K")).toBeInTheDocument();
    expect(screen.getByText("100K")).toBeInTheDocument();
    expect(screen.getByText("$1.25/M")).toBeInTheDocument();
    expect(screen.getByText("$4.50/M")).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("Tool calling")).toBeInTheDocument();
    expect(screen.getByText("Vision")).toBeInTheDocument();
    expect(screen.getByText("Structured output")).toBeInTheDocument();
    expect(screen.getByText("Temperature control")).toBeInTheDocument();
    expect(screen.getByText("Open weights")).toBeInTheDocument();
    expect(screen.getByText("Fast mode")).toBeInTheDocument();
    expect(screen.getByText("Interleaved reasoning")).toBeInTheDocument();
    expect(screen.getByText("PDF input")).toBeInTheDocument();
    expect(screen.getByText("Audio input")).toBeInTheDocument();
    expect(screen.getByText("Image output")).toBeInTheDocument();
    expect(screen.getByText("Audio output")).toBeInTheDocument();
    expect(screen.queryByText("Input modalities")).not.toBeInTheDocument();
    expect(screen.queryByText("Output modalities")).not.toBeInTheDocument();
    expect(screen.getAllByText("Vision")).toHaveLength(1);
    expect(screen.getAllByText("PDF input")).toHaveLength(1);
    expect(screen.getByText("example-v2")).toBeInTheDocument();
    expect(screen.getByText("120B")).toBeInTheDocument();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    expect(screen.getByText("Limits")).toBeInTheDocument();
    expect(screen.getByText("Pricing reference")).toBeInTheDocument();
    expect(screen.getByText("Reference")).toBeInTheDocument();
    expect(
      document.querySelector('[data-model-metadata-group="capabilities"]'),
    ).toHaveTextContent("Reasoning");
    expect(
      document.querySelector('[data-model-metadata-group="limits"]'),
    ).toHaveTextContent("Context1M");
    expect(
      document.querySelector('[data-model-metadata-group="pricing"]'),
    ).toHaveTextContent("Input$1.25/M");
    expect(
      document.querySelector('[data-model-metadata-group="reference"]'),
    ).toHaveTextContent("Released2026-02-03");
    expect(
      screen.queryByText("Capabilities from models.dev"),
    ).not.toBeInTheDocument();
    const pills = document.querySelectorAll("[data-model-metadata-pill]");
    expect(pills.length).toBeGreaterThan(10);
    expect(
      screen.getByText("1M").closest("[data-model-metadata-pill]"),
    ).toHaveTextContent("Context1M");
    expect(
      screen.getByText("Reasoning").closest("[data-model-metadata-pill]"),
    ).toHaveTextContent("Reasoning");
    expect(
      screen.getByText("Reasoning").closest("[data-model-metadata-pill]"),
    ).toHaveAttribute("data-model-metadata-tone", "violet");
    expect(
      screen.getByText("Tool calling").closest("[data-model-metadata-pill]"),
    ).toHaveAttribute("data-model-metadata-tone", "blue");
    expect(
      screen.getByText("Vision").closest("[data-model-metadata-pill]"),
    ).toHaveAttribute("data-model-metadata-tone", "cyan");
  });

  it("renders Hermes provider pricing without exposing provenance internals", () => {
    render(
      <ModelInfoCard
        metadata={{
          input_price: "$3.00",
          output_price: "free",
          cache_read_price: "$0.30",
          pricing_source: "provider-live",
          fast_mode: true,
          fast_mode_source: "hermes-runtime",
        }}
        model="provider-model"
        provider="example"
        showIdentity={false}
      />,
    );

    expect(screen.getByText("$3.00/M")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("$0.30/M")).toBeInTheDocument();
    expect(screen.getByText("Fast mode")).toBeInTheDocument();
    expect(screen.queryByText("Provider Live")).not.toBeInTheDocument();
    expect(screen.queryByText("Hermes Runtime")).not.toBeInTheDocument();
  });

  it("keeps the external row focused on capabilities before limits", () => {
    render(
      <ModelInfoCard
        metadata={{
          context_window: 1_000_000,
          max_output_tokens: 128_000,
          input_price_per_mtok: 1.25,
          reasoning: true,
          supports_tools: true,
          model_family: "example-v2",
          release_date: "2026-02-03",
        }}
        model="compact-model"
        provider="example"
      />,
    );

    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("Tool calling")).toBeInTheDocument();
    expect(screen.getByText("1M")).toBeInTheDocument();
    expect(screen.getByText("128K")).toBeInTheDocument();
    expect(screen.queryByText("Capabilities")).not.toBeInTheDocument();
    expect(screen.queryByText("Limits")).not.toBeInTheDocument();
    expect(screen.queryByText("$1.25/M")).not.toBeInTheDocument();
    expect(screen.queryByText("example-v2")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-02-03")).not.toBeInTheDocument();

    const visiblePills = Array.from(
      document.querySelectorAll("[data-model-metadata-pill]"),
    ).map((element) => element.textContent);
    expect(visiblePills).toEqual(["Reasoning", "Tool calling"]);
    const visibleMetrics = Array.from(
      document.querySelectorAll("[data-model-metric]"),
    ).map((element) => element.textContent);
    expect(visibleMetrics).toEqual(["1M", "128K"]);
    expect(
      document.querySelector('[data-model-metric="context"]'),
    ).toHaveAccessibleName("Context 1M");
    expect(
      document.querySelector('[data-model-metric="max-output"]'),
    ).toHaveAccessibleName("Max output 128K");
  });

  it("uses the readable name as the title and keeps the model id inline", () => {
    const { rerender } = render(
      <ModelInfoCard
        description="Readable Model"
        model="vendor/readable-model-v2"
        provider="example"
      />,
    );

    const identityLine = document.querySelector("[data-model-identity-line]");
    expect(identityLine).toHaveTextContent(
      "Readable Modelvendor/readable-model-v2",
    );
    expect(
      identityLine?.querySelector("[data-model-primary-name]"),
    ).toHaveTextContent("Readable Model");
    expect(identityLine?.querySelector("[data-model-id]")).toHaveTextContent(
      "vendor/readable-model-v2",
    );

    rerender(<ModelInfoCard model="vendor/id-only-model" provider="example" />);

    expect(
      document.querySelector("[data-model-primary-name]"),
    ).toHaveTextContent("vendor/id-only-model");
    expect(document.querySelector("[data-model-id]")).not.toBeInTheDocument();
  });
});
