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

describe("makeSessionModelEngine (rc.2 wire mapping)", () => {
  const sessionId = "session-1" as Parameters<SessionModelWire["selectModel"]>[0]["sessionId"];
  it("reads the session binding and selects through the rc.2 wire", async () => {
    const modelCatalog = vi.fn().mockResolvedValue({ ok: true, value: {
      default: { provider: "deepseek", model: "default" }, routableProviders: ["deepseek"],
    }});
    const modelSelection = vi.fn(() => ({ provider: "deepseek", model: "model-a" }));
    const selectModel = vi.fn(async selection => ({ ok: true, value: { selected: selection } }));
    const bound = makeSessionModelEngine({ modelCatalog, modelSelection, selectModel } as unknown as SessionModelWire, sessionId);
    await expect(bound.directory()).resolves.toEqual({ current: { provider: "deepseek", model: "model-a" }, routable: true });
    expect(modelSelection).toHaveBeenCalledWith(sessionId);
    await bound.select({ provider: "deepseek", model: "model-b", reasoningEffort: "max" });
    expect(selectModel).toHaveBeenCalledWith({ sessionId, provider: "deepseek", model: "model-b", reasoningEffort: "max" });
    await bound.select({ provider: "deepseek", model: "model-a" });
    expect(selectModel).toHaveBeenLastCalledWith({ sessionId, provider: "deepseek", model: "model-a" });
  });
  it("reports wire failures", async () => {
    const refused = { ok: false, error: { code: "invalid-model", message: "unknown route" } };
    const bound = makeSessionModelEngine({ modelCatalog: async () => refused, selectModel: async () => refused } as unknown as SessionModelWire, sessionId);
    await expect(bound.directory()).rejects.toThrow("unknown route");
    await expect(bound.select({ provider: "x", model: "y" })).rejects.toThrow("unknown route");
  });
});
