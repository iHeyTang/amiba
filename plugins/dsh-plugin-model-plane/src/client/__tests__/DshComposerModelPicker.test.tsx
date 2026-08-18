import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DshComposerModelPicker,
  type ComposerPickerAgentModels,
  type ComposerPickerCatalog,
} from "../DshComposerModelPicker.js";

const directory = vi.fn();
const snapshot = vi.fn();
const select = vi.fn();

const catalog: ComposerPickerCatalog = { snapshot };
const agentModels: ComposerPickerAgentModels = { directory, select };

describe("DshComposerModelPicker slot contribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const groups = [
      {
        id: "deepseek",
        name: "DeepSeek",
        models: [
          { id: "model-a", name: "Model A" },
          {
            id: "model-b",
            name: "Model B",
            reasoning: {
              defaultEffort: "high",
              efforts: [
                { id: "off", name: "Off" },
                { id: "high", name: "High" },
                { id: "max", name: "Max" },
              ],
            },
          },
        ],
      },
    ];
    directory.mockResolvedValue({
      current: { provider: "deepseek", model: "model-a" },
      routable: true,
    });
    snapshot.mockResolvedValue({ groups });
    select.mockImplementation(
      async (_sessionId: string, selection: unknown) => ({
        selected: selection,
      }),
    );
  });

  it("renders the plane catalog and selects through the agentModels pass-through", async () => {
    const user = userEvent.setup();
    render(
      <DshComposerModelPicker
        agentModels={agentModels}
        catalog={catalog}
        sessionId="session-1"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Choose model" });
    await waitFor(() => expect(trigger).toHaveTextContent("Model A"));
    expect(directory).toHaveBeenCalledWith("session-1");
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Choose model" });
    expect(within(dialog).getAllByText("Model B")).toHaveLength(1);
    expect(
      within(dialog).queryByText("Model B · High"),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByText("Model B"));

    expect(select).toHaveBeenCalledWith("session-1", {
      provider: "deepseek",
      model: "model-b",
      reasoningEffort: "high",
    });
    await waitFor(() => expect(trigger).toHaveTextContent("Model B"));
    expect(trigger).not.toHaveTextContent("High");

    const effortTrigger = await screen.findByRole("button", {
      name: "Reasoning effort: High",
    });
    await user.click(effortTrigger);
    const effortMenu = await screen.findByRole("menu", {
      name: "Reasoning effort",
    });
    await user.click(
      within(effortMenu).getByRole("menuitemradio", { name: "Max" }),
    );
    expect(select).toHaveBeenLastCalledWith("session-1", {
      provider: "deepseek",
      model: "model-b",
      reasoningEffort: "max",
    });
  });

  it("keeps a draft model choice before the first DSH session exists", async () => {
    const user = userEvent.setup();
    const onDraftSelectionChange = vi.fn();
    render(
      <DshComposerModelPicker
        agentModels={agentModels}
        catalog={catalog}
        onDraftSelectionChange={onDraftSelectionChange}
        sessionId={null}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Choose model" });
    await waitFor(() => expect(snapshot).toHaveBeenCalled());
    expect(directory).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent("Choose model");
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Choose model" });
    await user.click(within(dialog).getByText("Model B"));

    expect(select).not.toHaveBeenCalled();
    expect(onDraftSelectionChange).toHaveBeenCalledWith({
      provider: "deepseek",
      model: "model-b",
      reasoningEffort: "high",
    });
    await waitFor(() => expect(trigger).toHaveTextContent("Model B"));

    const effortTrigger = await screen.findByRole("button", {
      name: "Reasoning effort: High",
    });
    await user.click(effortTrigger);
    const effortMenu = await screen.findByRole("menu", {
      name: "Reasoning effort",
    });
    await user.click(
      within(effortMenu).getByRole("menuitemradio", { name: "Max" }),
    );
    expect(onDraftSelectionChange).toHaveBeenLastCalledWith({
      provider: "deepseek",
      model: "model-b",
      reasoningEffort: "max",
    });
  });

  it("uses the Model Plane product default before creating a DSH session", async () => {
    snapshot.mockResolvedValueOnce({
      groups: [
        {
          id: "deepseek",
          name: "DeepSeek",
          models: [{ id: "model-a", name: "Model A" }],
        },
      ],
      defaultSelection: { provider: "deepseek", model: "model-a" },
    });
    const onDraftSelectionChange = vi.fn();

    render(
      <DshComposerModelPicker
        agentModels={agentModels}
        catalog={catalog}
        onDraftSelectionChange={onDraftSelectionChange}
        sessionId={null}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Choose model" });
    await waitFor(() => expect(trigger).toHaveTextContent("Model A"));
    expect(onDraftSelectionChange).toHaveBeenCalledWith({
      provider: "deepseek",
      model: "model-a",
    });
    expect(select).not.toHaveBeenCalled();
  });
});
