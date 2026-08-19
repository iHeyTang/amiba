import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DshComposerModelPicker,
  makeSessionModelEngine,
  type ComposerPickerCatalog,
  type ComposerPickerEngine,
  type SessionModelWire,
} from "../DshComposerModelPicker.js";

const directory = vi.fn();
const snapshot = vi.fn();
const select = vi.fn();

const catalog: ComposerPickerCatalog = { snapshot };
const engine: ComposerPickerEngine = { directory, select };

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
  select.mockImplementation(async (selection: unknown) => ({
    selected: selection,
  }));
});

describe("session seat (conversation.input.model occupant)", () => {
  it("renders the plane catalog and selects through the session-bound engine", async () => {
    const user = userEvent.setup();
    render(<DshComposerModelPicker catalog={catalog} engine={engine} />);

    const trigger = screen.getByRole("button", { name: "Choose model" });
    await waitFor(() => expect(trigger).toHaveTextContent("Model A"));
    expect(directory).toHaveBeenCalledTimes(1);
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Choose model" });
    expect(within(dialog).getAllByText("Model B")).toHaveLength(1);
    expect(
      within(dialog).queryByText("Model B · High"),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByText("Model B"));

    expect(select).toHaveBeenCalledWith({
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
    expect(select).toHaveBeenLastCalledWith({
      provider: "deepseek",
      model: "model-b",
      reasoningEffort: "max",
    });
  });

  it("locks the trigger when the owner share says locked", async () => {
    render(
      <DshComposerModelPicker catalog={catalog} disabled engine={engine} />,
    );
    const trigger = screen.getByRole("button", { name: "Choose model" });
    await waitFor(() => expect(trigger).toHaveTextContent("Model A"));
    expect(trigger).toBeDisabled();
  });

  it("surfaces a wire failure as the picker error state", async () => {
    directory.mockRejectedValueOnce(
      new Error("session.models failed: internal: boom"),
    );
    render(<DshComposerModelPicker catalog={catalog} engine={engine} />);
    const trigger = screen.getByRole("button", { name: "Choose model" });
    await waitFor(() => expect(trigger).toHaveAttribute("aria-invalid", "true"));
    expect(trigger).toHaveAttribute(
      "title",
      "session.models failed: internal: boom",
    );
  });
});

describe("draft seat (amiba.composer.modelPicker hero occupant)", () => {
  it("keeps a draft model choice before the first DSH session exists", async () => {
    const user = userEvent.setup();
    const onDraftSelectionChange = vi.fn();
    render(
      <DshComposerModelPicker
        catalog={catalog}
        onDraftSelectionChange={onDraftSelectionChange}
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
        catalog={catalog}
        onDraftSelectionChange={onDraftSelectionChange}
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

describe("makeSessionModelEngine (official wire mapping)", () => {
  const sessionId = "session-1" as Parameters<
    SessionModelWire["models"]
  >[0]["sessionId"];

  it("maps session.models / session.selectModel payloads and unwraps results", async () => {
    const models = vi.fn().mockResolvedValue({
      result: {
        ok: true,
        value: {
          current: { provider: "deepseek", model: "model-a" },
          routable: true,
          groups: [],
          failures: [],
        },
      },
    });
    const selectModel = vi.fn().mockResolvedValue({
      result: {
        ok: true,
        value: {
          selected: {
            provider: "deepseek",
            model: "model-b",
            reasoningEffort: "max",
          },
        },
      },
    });
    const wire = { models, selectModel } as unknown as SessionModelWire;
    const bound = makeSessionModelEngine(wire, sessionId);

    await expect(bound.directory()).resolves.toEqual({
      current: { provider: "deepseek", model: "model-a" },
      routable: true,
    });
    expect(models).toHaveBeenCalledWith({ sessionId: "session-1" });

    await expect(
      bound.select({
        provider: "deepseek",
        model: "model-b",
        reasoningEffort: "max",
      }),
    ).resolves.toEqual({
      selected: {
        provider: "deepseek",
        model: "model-b",
        reasoningEffort: "max",
      },
    });
    expect(selectModel).toHaveBeenCalledWith({
      sessionId: "session-1",
      provider: "deepseek",
      model: "model-b",
      reasoningEffort: "max",
    });
    // Effort-less selections must not send an explicit undefined on the wire.
    await bound.select({ provider: "deepseek", model: "model-a" });
    expect(selectModel).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      provider: "deepseek",
      model: "model-a",
    });
  });

  it("folds wire refusals into thrown errors (fail loud)", async () => {
    const wire = {
      models: vi.fn().mockResolvedValue({
        result: {
          ok: false,
          error: { code: "agent-busy", message: "subagent session" },
        },
      }),
      selectModel: vi.fn().mockResolvedValue({
        result: {
          ok: false,
          error: { code: "invalid-model", message: "unknown route" },
        },
      }),
    } as unknown as SessionModelWire;
    const bound = makeSessionModelEngine(wire, sessionId);

    await expect(bound.directory()).rejects.toThrow(
      "session.models failed: agent-busy: subagent session",
    );
    await expect(
      bound.select({ provider: "x", model: "y" }),
    ).rejects.toThrow("session.selectModel failed: invalid-model: unknown route");
  });
});
