import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPicker: vi.fn(),
  getCurrent: vi.fn(),
  setMain: vi.fn(),
  watchDisplay: vi.fn(() => () => {}),
}));

vi.mock("@amiba/core", () => ({
  hermesModelGateway: {
    picker: { read: mocks.getPicker, readCurrent: mocks.getCurrent },
    main: { write: mocks.setMain },
    display: { watch: mocks.watchDisplay },
  },
}));

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { ComposerModelPicker } from "../ComposerModelPicker";

describe("ComposerModelPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPicker.mockResolvedValue({
      ok: true,
      current: {
        provider: "provider-a",
        model: "model-a",
      },
      groups: [
        {
          label: "Provider A",
          provider: "provider-a",
          models: [
            { id: "model-a", description: "Model A" },
            { id: "model-b", description: "Model B" },
          ],
        },
      ],
      capabilities: [],
    });
    mocks.getCurrent.mockResolvedValue({
      ok: true,
      current: {
        provider: "provider-a",
        model: "model-a",
      },
      summary: {
        provider: "provider-a",
        model: "model-a",
        entry: {
          id: "model-a",
          description: "Model A",
        },
        updatedAt: 1,
      },
    });
    mocks.setMain.mockResolvedValue({
      ok: true,
      provider: "provider-a",
      model: "model-b",
    });
  });

  it("exposes the active Hermes model from the composer toolbar", async () => {
    render(<ComposerModelPicker />);

    const trigger = screen.getByRole("button", {
      name: "sidepanel.modelPicker.label",
    });
    await waitFor(() => {
      expect(trigger).toHaveTextContent("Model A");
    });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveClass("rounded-full");
    expect(trigger).not.toHaveClass("rounded-md");
    expect(trigger).toHaveClass("focus:outline-none");
    expect(trigger.className).not.toContain("focus:ring");
  });

  it("shows the remembered current model while the live catalog is pending", async () => {
    mocks.getPicker.mockReturnValue(new Promise(() => undefined));
    mocks.getCurrent.mockResolvedValue({
      ok: true,
      current: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
      },
      summary: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        entry: {
          id: "deepseek-v4-pro",
          description: "DeepSeek V4 Pro",
          metadata: {
            context_window: 1_000_000,
            supports_reasoning: true,
          },
        },
        updatedAt: 1,
      },
    });

    render(<ComposerModelPicker />);

    const trigger = screen.getByRole("button", {
      name: "sidepanel.modelPicker.label",
    });
    await waitFor(() => {
      expect(trigger).toHaveTextContent("DeepSeek V4 Pro");
    });
    expect(
      trigger.querySelector('[data-model-icon="deepseek"]'),
    ).toBeInTheDocument();
    expect(trigger.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("refreshes a hidden renderer's stale model failure when its host is shown", async () => {
    mocks.getCurrent.mockResolvedValueOnce({
      ok: false,
      current: { provider: "", model: "" },
      summary: null,
    });
    mocks.getPicker.mockResolvedValueOnce({
      ok: false,
      current: { provider: "", model: "" },
      groups: [],
      capabilities: [],
    });
    const { rerender } = render(<ComposerModelPicker refreshKey={0} />);

    const trigger = screen.getByRole("button", {
      name: "sidepanel.modelPicker.label",
    });
    await waitFor(() =>
      expect(trigger).toHaveTextContent("sidepanel.modelPicker.loadFailed"),
    );

    rerender(<ComposerModelPicker refreshKey={1} />);

    await waitFor(() => expect(trigger).toHaveTextContent("Model A"));
    expect(mocks.getPicker).toHaveBeenCalledTimes(2);
  });

  it("loads configured models from the input bar and switches Hermes", async () => {
    const user = userEvent.setup();
    render(<ComposerModelPicker />);

    const trigger = screen.getByRole("button", {
      name: "sidepanel.modelPicker.label",
    });
    await waitFor(() => {
      expect(trigger).toHaveTextContent("Model A");
    });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.modelPicker.label",
    });
    expect(dialog).toHaveAttribute("data-composer-overlay");
    expect(
      within(dialog).getByTestId("model-picker-input"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByText("model-b"));

    expect(mocks.getPicker).toHaveBeenCalled();
    expect(mocks.setMain).toHaveBeenCalledWith({
      provider: "provider-a",
      model: "model-b",
      base_url: null,
    });
    await waitFor(() => {
      expect(trigger).toHaveTextContent("Model B");
      expect(
        screen.queryByRole("dialog", {
          name: "sidepanel.modelPicker.label",
        }),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps model selection modal while making its overlay transparent when requested", async () => {
    const user = userEvent.setup();
    render(
      <ComposerModelPicker
        dialogSize="tall"
        overlayVariant="transparent"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "sidepanel.modelPicker.label",
    });
    await waitFor(() => expect(trigger).toHaveTextContent("Model A"));
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.modelPicker.label",
    });
    expect(dialog).toHaveAttribute("data-model-picker-modal", "true");
    expect(dialog).toHaveClass("fixed");
    expect(
      within(dialog).getByTestId("model-picker-input").closest("[cmdk-root]"),
    ).toHaveClass("max-h-[min(calc(100vh-2rem),32rem)]");
    expect(
      document.querySelector('[data-dialog-overlay="transparent"]'),
    ).toHaveClass("bg-transparent");

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "sidepanel.modelPicker.label" }),
    ).not.toBeInTheDocument();
  });

  it("filters models and providers inside the modal", async () => {
    const user = userEvent.setup();
    render(<ComposerModelPicker />);

    const trigger = screen.getByRole("button", {
      name: "sidepanel.modelPicker.label",
    });
    await waitFor(() => {
      expect(trigger).toHaveTextContent("Model A");
    });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.modelPicker.label",
    });
    await user.type(
      within(dialog).getByTestId("model-picker-input"),
      "model-b",
    );

    expect(within(dialog).getByText("model-b")).toBeInTheDocument();
    expect(within(dialog).queryByText("model-a")).not.toBeInTheDocument();
  });

  it("renders the resolved model family icon in the trigger and list", async () => {
    mocks.getPicker.mockResolvedValue({
      ok: true,
      current: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
      },
      groups: [
        {
          label: "DeepSeek",
          provider: "deepseek",
          models: [
            {
              id: "deepseek-v4-pro",
              description: "DeepSeek V4 Pro",
              metadata: {
                context_window: 1_000_000,
                max_output_tokens: 128_000,
                reasoning: true,
                tool_call: true,
              },
            },
            { id: "deepseek-v4-flash" },
          ],
        },
      ],
      capabilities: [],
    });
    const user = userEvent.setup();
    render(<ComposerModelPicker />);

    const trigger = screen.getByRole("button", {
      name: "sidepanel.modelPicker.label",
    });
    await waitFor(() => {
      expect(trigger).toHaveTextContent("DeepSeek V4 Pro");
      expect(
        trigger.querySelector('[data-model-icon="deepseek"]'),
      ).toBeInTheDocument();
    });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.modelPicker.label",
    });
    expect(
      dialog.querySelectorAll('[data-model-icon="deepseek"]'),
    ).toHaveLength(2);
    const richModel = dialog.querySelector(
      '[data-model-summary="deepseek-v4-pro"]',
    );
    expect(richModel).toHaveTextContent("1M");
    expect(richModel).toHaveTextContent("128K");
    expect(richModel).toHaveTextContent(
      "options.models.card.capability.reasoning",
    );
    expect(richModel).toHaveTextContent("options.models.card.capability.tools");
  });

  it("labels virtual capabilities separately from service-provider models", async () => {
    mocks.getPicker.mockResolvedValue({
      ok: true,
      current: {
        provider: "moa",
        model: "review",
      },
      groups: [
        {
          label: "Provider A",
          provider: "provider-a",
          models: [{ id: "model-a" }],
        },
      ],
      capabilities: [
        {
          capability: "moa",
          label: "Mixture of Agents",
          provider: "moa",
          models: [{ id: "review", description: "Review Ensemble" }],
        },
      ],
    });
    const user = userEvent.setup();
    render(<ComposerModelPicker />);

    const trigger = screen.getByRole("button", {
      name: "sidepanel.modelPicker.label",
    });
    await waitFor(() => {
      expect(trigger).toHaveTextContent(
        "options.models.virtual.moaTitle · Review Ensemble",
      );
    });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.modelPicker.label",
    });
    expect(dialog).toHaveAttribute("data-model-picker-modal", "true");
    expect(within(dialog).getByText("sidepanel.modelPicker.label")).toHaveClass(
      "sr-only",
    );
    expect(
      within(dialog).queryByText("sidepanel.modelPicker.models"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("sidepanel.modelPicker.virtualCapabilities"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("options.models.virtual.moaTitle"),
    ).toBeInTheDocument();
  });
});
