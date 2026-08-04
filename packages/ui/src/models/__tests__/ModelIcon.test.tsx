import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModelIcon, resolveModelIconName } from "../ModelIcon";

describe("ModelIcon", () => {
  it("prefers the model family over the transport provider", () => {
    expect(
      resolveModelIconName("copilot", "anthropic/claude-sonnet-4.6"),
    ).toBe("claude");
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
});
