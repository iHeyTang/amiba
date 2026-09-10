import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModelIcon, resolveModelIconName } from "../ModelIcon";
import catalog from "./fixtures/provider-icon-catalog.json";

describe("ModelIcon", () => {
  it("prefers the model family over the transport provider", () => {
    expect(resolveModelIconName("copilot", "anthropic/claude-sonnet-4.6")).toBe(
      "claude",
    );
    expect(resolveModelIconName("openrouter", "google/gemini-3-pro")).toBe(
      "gemini",
    );
    expect(resolveModelIconName("nous", "xiaomi/mimo-v2.5-pro")).toBe(
      "xiaomimimo",
    );
  });

  it("falls back to the provider when the model family is unknown", () => {
    expect(resolveModelIconName("copilot", "future-model")).toBe(
      "githubcopilot",
    );
    expect(resolveModelIconName("openrouter", "future-model")).toBe(
      "openrouter",
    );
  });

  it("renders color assets directly and keeps mono assets theme-safe", () => {
    const { container, rerender } = render(
      <ModelIcon model="deepseek-v4-pro" provider="deepseek" />,
    );
    expect(
      container.querySelector('img[data-model-icon="deepseek"]'),
    ).toBeInTheDocument();

    rerender(<ModelIcon model="future-model" provider="copilot" />);
    const monoIcon = container.querySelector(
      'span[data-model-icon="githubcopilot"]',
    );
    expect(monoIcon).toBeInTheDocument();
    expect(monoIcon?.getAttribute("style")).toContain("mask-image");
    expect((monoIcon as HTMLElement).style.maskImage).toMatch(/^url\("/);
  });

  it("uses the generic chip only when neither identity is known", () => {
    expect(resolveModelIconName("custom", "private-model")).toBeNull();

    const { container } = render(
      <ModelIcon model="private-model" provider="custom" />,
    );
    expect(
      container.querySelector('[data-model-icon="generic"]'),
    ).toBeInTheDocument();
  });
  it("uses theme-inheriting marks for white or low-contrast brand variants", () => {
    const { container, rerender } = render(
      <ModelIcon provider="kimi" model="" />,
    );
    expect(
      (
        container.querySelector('span[data-model-icon="kimi"]') as HTMLElement
      ).style.backgroundColor.toLowerCase(),
    ).toBe("currentcolor");
    rerender(<ModelIcon provider="openrouter" model="" />);
    expect(
      container.querySelector('span[data-model-icon="openrouter"]'),
    ).toBeInTheDocument();
  });
  it("recognizes official DSH route names without falling back to an unrelated mark", () => {
    for (const [provider, icon] of Object.entries({
      "deepseek-official": "deepseek",
      "amazon-bedrock": "bedrock",
      "azure-openai-responses": "azureai",
      "moonshotai-cn": "moonshot",
      "google-vertex": "gemini",
      "qwen-token-plan": "qwen",
      together: "together",
    })) {
      expect(resolveModelIconName(provider, "")).toBe(icon);
    }
  });
  it("covers every bundled official provider and every TokenDance catalog family", () => {
    for (const provider of catalog.providers)
      expect(resolveModelIconName(provider, ""), provider).not.toBeNull();
    // An empty transport ensures this checks model identity, not a fallback.
    for (const model of catalog.models)
      expect(resolveModelIconName("", model), model).not.toBeNull();
  });
  it("recognizes model owner namespaces behind an aggregator", () => {
    for (const [model, icon] of Object.entries({
      "arcee-ai/trinity-mini": "arcee",
      "aion-labs/aion-3.0": "aionlabs",
      "@cf/ibm-granite/granite-4.0-h-micro": "ibm",
      "inclusionai/ring-2.6-1t": "antgroup",
      "mistralai/devstral-2512": "mistral",
      "meta/muse-spark-1.1": "meta",
      "poolside/laguna-m.1": "poolside",
      "bytedance-seed/seed-2.0-mini": "bytedance",
      "tencent/hy3-preview": "hunyuan",
      "dots-3-note-preview": "dots",
      "unifuncs-u3-pro": "unifuncs",
    }))
      expect(resolveModelIconName("openrouter", model)).toBe(icon);
  });
  it("does not interpret an incidental brand substring as model identity", () => {
    expect(resolveModelIconName("custom", "seedling-private")).toBeNull();
    expect(resolveModelIconName("custom", "offspring-private")).toBeNull();
    expect(
      resolveModelIconName("openrouter", "unknown-owner/private-model"),
    ).toBe("openrouter");
  });
});
