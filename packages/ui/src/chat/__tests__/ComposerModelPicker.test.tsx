import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

import { ComposerModelPicker } from "../ComposerModelPicker";

const directory = vi.fn();
const snapshot = vi.fn();
const select = vi.fn();

describe("ComposerModelPicker DSH adapter", () => {
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
      groups,
      failures: [],
    });
    snapshot.mockResolvedValue({
      revision: 1,
      providers: [],
      groups,
      credentials: {},
      failures: [],
    });
    select.mockImplementation(
      async (_sessionId: string, selection: unknown) => ({
        selected: selection,
      }),
    );
    setPlatform({
      storage: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
        watch: vi.fn(() => () => {}),
      },
      modelPlane: {
        snapshot,
        setDefaultSelection: vi.fn(),
        upsert: vi.fn(),
        remove: vi.fn(),
        discover: vi.fn(),
        unsetCredential: vi.fn(),
      },
      agentModels: {
        directory,
        select,
      },
    } as unknown as PlatformAdapter);
  });

  it("loads and switches the model through the session-scoped DSH API", async () => {
    const user = userEvent.setup();
    render(<ComposerModelPicker sessionId="session-1" />);

    const trigger = screen.getByRole("button", { name: "Choose model" });
    await waitFor(() => expect(trigger).toHaveTextContent("Model A"));
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
      <ComposerModelPicker onDraftSelectionChange={onDraftSelectionChange} />,
    );

    const trigger = screen.getByRole("button", { name: "Choose model" });
    await waitFor(() => expect(snapshot).toHaveBeenCalled());
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
      revision: 2,
      providers: [],
      groups: [
        {
          id: "deepseek",
          name: "DeepSeek",
          models: [{ id: "model-a", name: "Model A" }],
        },
      ],
      defaultSelection: { provider: "deepseek", model: "model-a" },
      credentials: {},
      failures: [],
    });
    const onDraftSelectionChange = vi.fn();

    render(
      <ComposerModelPicker onDraftSelectionChange={onDraftSelectionChange} />,
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
