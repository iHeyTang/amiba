import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Terminal } from "lucide-react";
import type { ToolCallBlock, ToolCallOwnerProps, ToolResultNode, ImageAttachmentRef } from "@amiba/extension-sdk";
import type { ToolProgress } from "@amiba/app-runtime/core";
import { SemanticToolRow } from "../bubble/semantic-tool-row";
import { ToolCallSeatProvider, type ToolCallSeatRenderer } from "../bubble/tool-call-seat";
import { ToolImageEvidenceProvider } from "../bubble/tool-image-evidence";
import { createToolNavigation } from "../bubble/tool-navigation";
import { MessageTurns } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));

function block(callId: string, name: string, subCalls: ToolCallBlock[] = []): ToolResultNode {
  return { kind: "tool-result", callId, call: { name, argsRaw: '{"path":"original.txt"}' }, seq: 3, time: 100,
    callTime: null, callView: null, resultView: null, isError: false,
    content: [{ type: "text", text: `${callId} evidence` }], subCalls };
}
const leaf = block("leaf", "custom_leaf");
const child = block("child", "known_child", [leaf]);
const sibling = block("sibling", "custom_leaf");
const parent: ToolCallOwnerProps = { callId: "parent", toolName: "run_code", block: block("parent", "run_code", [child, sibling]),
  cwd: "/original", openFile: vi.fn(), inspect: vi.fn(), loadImage: vi.fn(async () => "blob:authorized") };
function row(owner: ToolCallOwnerProps) {
  return <SemanticToolRow owner={owner} tag={owner.toolName} t={key => key}
    spec={{ icon: Terminal, action: owner.callId, evidence: () => <div>{owner.callId} evidence</div> }} />;
}

describe("nested atomic tool dispatch", () => {
  it("keeps parent evidence and dispatches every depth exactly once with original identities", () => {
    const owners: ToolCallOwnerProps[] = [];
    const dispatch: ToolCallSeatRenderer = ({ owner, fallback }) => { owners.push(owner); return owner.toolName === "known_child" ? row(owner) : fallback; };
    render(<ToolCallSeatProvider render={dispatch}>{row(parent)}</ToolCallSeatProvider>);
    expect(owners).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "parent" }));
    expect(screen.getByText("parent evidence")).toBeInTheDocument();
    expect(owners.map(owner => owner.callId)).toEqual(["child", "leaf", "sibling"]);
    expect(owners[0]?.block).toBe(child);
    expect(owners[1]?.block).toBe(leaf);
    for (const owner of owners) {
      expect(owner.cwd).toBe("/original");
      expect(owner.openFile).toBe(parent.openFile);
      expect(owner.loadImage).toBe(parent.loadImage);
      expect(owner.inspect).toBeUndefined(); // Shell must bind inspect to this child's ID.
    }
    fireEvent.click(screen.getByRole("button", { name: "child" }));
    expect(screen.getByText("child evidence")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "custom_leaf" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "custom_leaf" })[0]!);
    expect(screen.getByText("leaf evidence")).toBeInTheDocument();
  });
  it("updates a running child in place without discarding its plugin state", () => {
    const running: ToolCallBlock = { callId: "child", name: "known_child", argsRaw: "{}", turn: 1, step: 1, time: 10, callView: null, subCalls: [] };
    function Counter({ owner }: { owner: ToolCallOwnerProps }) {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>{owner.callId} {"kind" in owner.block ? "done" : "running"} {count}</button>;
    }
    const dispatch: ToolCallSeatRenderer = ({ owner }) => <Counter owner={owner} />;
    const view = render(<ToolCallSeatProvider render={dispatch}>{row({ ...parent, block: { ...parent.block, subCalls: [running] } })}</ToolCallSeatProvider>);
    fireEvent.click(screen.getByRole("button", { name: "parent" }));
    fireEvent.click(screen.getByRole("button", { name: "child running 0" }));
    view.rerender(<ToolCallSeatProvider render={dispatch}>{row({ ...parent, block: { ...parent.block, subCalls: [block("child", "known_child")] } })}</ToolCallSeatProvider>);
    expect(screen.getByRole("button", { name: "child done 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "parent" })).toHaveAttribute("aria-expanded", "true");
  });
  it("preserves the original root DOM when no nested data or host dispatcher exists", () => {
    const base = render(row(parent));
    fireEvent.click(screen.getByRole("button", { name: "parent" }));
    const expected = base.container.innerHTML;
    base.unmount();
    const noChildren = { ...parent, block: { ...parent.block, subCalls: [] } };
    const view = render(<ToolCallSeatProvider render={({ fallback }) => fallback}>{row(noChildren)}</ToolCallSeatProvider>);
    fireEvent.click(screen.getByRole("button", { name: "parent" }));
    expect(view.container.innerHTML).toBe(expected);
  });
  it("isolates a failing child and restores it when the dispatcher changes without closing the parent", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = () => { throw new Error("child plugin failed"); };
    const broken: ToolCallSeatRenderer = ({ owner, fallback }) => owner.callId === "child" ? <Broken /> : fallback;
    try {
      const view = render(<ToolCallSeatProvider render={broken}>{row(parent)}</ToolCallSeatProvider>);
      fireEvent.click(screen.getByRole("button", { name: "parent" }));
      expect(screen.getByText("parent evidence")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "custom_leaf" })).toHaveLength(2);
      expect(screen.getByRole("button", { name: "known_child" })).toBeInTheDocument();
      view.rerender(<ToolCallSeatProvider render={({ owner }) => <span>restored {owner.callId}</span>}>{row(parent)}</ToolCallSeatProvider>);
      expect(screen.getByText("restored child")).toBeInTheDocument();
      expect(screen.getByText("restored leaf")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "parent" })).toHaveAttribute("aria-expanded", "true");
    } finally { errors.mockRestore(); }
  });
  it("keeps a child's image in its own evidence instead of the parent gallery", () => {
    const attachment = { attachmentId: "nested-image" as ImageAttachmentRef["attachmentId"], mediaType: "image/png" as const, width: 1, height: 1, bytes: 90 };
    const imageChild = { ...leaf, content: [{ type: "image", attachment }] } as ToolCallBlock;
    const owner = { ...parent, block: { ...parent.block, subCalls: [imageChild] } };
    const galleries = vi.fn((images: unknown[]) => <div>child gallery {images.length}</div>);
    const dispatch: ToolCallSeatRenderer = ({ owner }) => <ToolImageEvidenceProvider callId={owner.callId} render={galleries}>{row(owner)}</ToolImageEvidenceProvider>;
    render(<ToolCallSeatProvider render={dispatch}><ToolImageEvidenceProvider callId={owner.callId} render={galleries}>{row(owner)}</ToolImageEvidenceProvider></ToolCallSeatProvider>);
    fireEvent.click(screen.getByRole("button", { name: "parent" }));
    expect(galleries).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "leaf" }));
    expect(galleries).toHaveBeenCalledWith([{ attachment }]);
    expect(screen.getAllByText("child gallery 1")).toHaveLength(1);
  });
  it("opens the native process and parent fold before revealing a deep child", async () => {
    const navigation = createToolNavigation();
    const scroll = vi.fn();
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const event: ToolProgress = { toolCallId: "parent", tool: "run_code", status: "completed", result: { text: "parent evidence" }, wire: {
        call: { argsRaw: "{}", turn: 1, step: 1, time: 50, callView: null },
        result: { seq: 3, time: 100, content: [{ type: "text", text: "parent evidence" }], isError: false, resultView: null }, subCalls: [child],
      } };
      const owners: ToolCallOwnerProps[] = [];
      const messages: UiMessage[] = [{ uiId: "u", role: "user", content: "run" }, { uiId: "a", role: "assistant", content: "done", toolProgress: [event] }];
      render(<ToolCallSeatProvider navigation={navigation} render={({ owner }) => { owners.push(owner); return row(owner); }}><MessageTurns messages={messages} /></ToolCallSeatProvider>);
      await act(async () => navigation.reveal("leaf"));
      expect(screen.getByRole("button", { name: "parent" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "leaf" })).toBeInTheDocument();
      expect(owners.findLast(owner => owner.callId === "leaf")?.revealVersion).toBe(1);
      expect(scroll).toHaveBeenCalled();
    } finally { HTMLElement.prototype.scrollIntoView = previous; }
  });
});
