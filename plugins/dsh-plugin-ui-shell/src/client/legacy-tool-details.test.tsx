// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationSnapshot, ToolCallBlock } from "@deepseek-ai/dsh-client-runtime/client";
import type { WorkbenchPanelOwner } from "@amiba/extension-sdk";
import { LegacyToolDetails, legacyToolCalls, LEGACY_TOOL_DETAILS_PANEL } from "./legacy-tool-details.js";

afterEach(cleanup);
const running: ToolCallBlock = { callId: "call-1", name: "bash", argsRaw: "{}", turn: 1, step: 1, time: 10, callView: null, subCalls: [] };
const settled: ToolCallBlock = { kind: "tool-result", callId: "call-1", seq: 2, time: 20, callTime: 10, call: { name: "bash", argsRaw: "{}" }, callView: null, resultView: null, content: [], isError: false, subCalls: [] };
const snapshot = (block: ToolCallBlock, sessionId = "s1") => ({ sessionId, nodes: "kind" in block ? [block] : [], runningCalls: "kind" in block ? [] : [block] }) as unknown as ConversationSnapshot;
const panel: WorkbenchPanelOwner = { placement: "content", activePanel: LEGACY_TOOL_DETAILS_PANEL, openPanel: vi.fn(), openResource: vi.fn(), inspectToolCall: () => false, renderMarkdown: () => <span /> };
const props = { sessionId: "s1", cwd: "/workspace", panel, selectedCallId: "call-1", onSelect: vi.fn(), label: "Tool details", emptyLabel: "Select a call" };
function source(initial: ConversationSnapshot) {
  let current = initial;
  const listeners = new Set<() => void>();
  return { getSnapshot: () => current, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(next: ConversationSnapshot) { current = next; listeners.forEach(listener => listener()); } };
}
describe("legacy tool details", () => {
  it("keeps exact running, settled and nested official objects", () => {
    const child = { ...running, callId: "child" };
    const parent = { ...settled, subCalls: [child] };
    const calls = legacyToolCalls(snapshot(parent));
    expect(calls[0]).toBe(parent);
    expect(calls[1]).toBe(child);
    expect(legacyToolCalls(snapshot(running))[0]).toBe(running);
    expect(legacyToolCalls(undefined)).toEqual([]);
  });
  it("updates the selected call from running to settled without changing selection", () => {
    const store = source(snapshot(running));
    const draw = vi.fn(owner => <div>{"kind" in owner.block ? "completed" : "running"}</div>);
    render(<LegacyToolDetails {...props} source={store} render={draw} />);
    expect(screen.getByText("running")).toBeTruthy();
    expect(draw.mock.calls.at(-1)?.[0]).toEqual({ block: running, cwd: "/workspace" });
    act(() => store.update(snapshot(settled)));
    expect(screen.getByText("completed")).toBeTruthy();
    expect(draw.mock.calls.at(-1)?.[0].block).toBe(settled);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("call-1");
  });
  it("never renders another session or substitutes a missing selected call", () => {
    const store = source(snapshot(settled, "s2"));
    const draw = vi.fn(() => null);
    const view = render(<LegacyToolDetails {...props} source={store} render={draw} />);
    expect(draw).not.toHaveBeenCalled();
    act(() => store.update(snapshot(settled)));
    draw.mockClear();
    view.rerender(<LegacyToolDetails {...props} selectedCallId="missing" source={store} render={draw} />);
    expect(draw).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "call-1" } });
    expect(props.onSelect).toHaveBeenCalledWith("call-1");
  });
  it("adds an explicit tab and leaves unrelated panels untouched", () => {
    const draw = vi.fn(() => null);
    const view = render(<LegacyToolDetails {...props} panel={{ ...panel, placement: "tab" }} render={draw} />);
    fireEvent.click(screen.getByRole("tab"));
    expect(panel.openPanel).toHaveBeenCalledWith(LEGACY_TOOL_DETAILS_PANEL);
    expect(draw).not.toHaveBeenCalled();
    view.rerender(<LegacyToolDetails {...props} panel={{ ...panel, activePanel: "another" }} render={draw} />);
    expect(view.container.innerHTML).toBe("");
  });
  it("requests restoration only when the contributed tab becomes unavailable", () => {
    const closePanel = vi.fn();
    const ownedPanel = { ...panel, placement: "tab" as const, closePanel };
    const draw = vi.fn(() => null);
    const view = render(<LegacyToolDetails {...props} panel={ownedPanel} render={draw} />);
    expect(closePanel).not.toHaveBeenCalled();
    view.rerender(<LegacyToolDetails {...props} panel={ownedPanel} enabled={false} render={draw} />);
    expect(closePanel).toHaveBeenCalledWith(LEGACY_TOOL_DETAILS_PANEL);
    expect(view.container.innerHTML).toBe("");
    expect(draw).not.toHaveBeenCalled();
  });
  it("isolates errors and recovers replacements while retaining selection controls", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = source(snapshot(settled));
      const view = render(<LegacyToolDetails {...props} source={store} render={() => { throw new Error("expected detail failure"); }} />);
      const select = screen.getByRole("combobox");
      view.rerender(<LegacyToolDetails {...props} source={store} render={() => <div>recovered detail</div>} />);
      expect(screen.getByText("recovered detail")).toBeTruthy();
      expect(screen.getByRole("combobox")).toBe(select);
    } finally { errors.mockRestore(); }
  });
});
