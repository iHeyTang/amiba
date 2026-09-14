import { describe, expect, it } from "vitest";
import type { SessionListState } from "@deepseek-ai/dsh-client-runtime/client";
import { sessionLineage, equalSessionLineage } from "./session-lineage.js";

function list(current: string, summaries: Record<string, unknown>): SessionListState {
  return { current, byId: summaries } as unknown as SessionListState;
}
const root = { id: "root", displayTitle: "Root", origin: "user" };
const parent = { id: "parent", displayTitle: "Parent child", origin: "subagent", parentId: "root" };
const child = { id: "child", displayTitle: "Nested child", origin: "subagent", parentId: "parent" };

describe("sessionLineage", () => {
  it("dispatches exactly the official eligible titles in ancestor-to-current order", () => {
    expect(sessionLineage(list("child", { root, parent, child }), "child")).toEqual([
      { id: "parent", displayTitle: "Parent child", current: false },
      { id: "child", displayTitle: "Nested child", current: true },
    ]);
    expect(sessionLineage(list("root", { root }), "root")).toEqual([
      { id: "root", displayTitle: "Root", current: true },
    ]);
  });
  it("never exposes the previous session for an unmaterialized or switched draft", () => {
    expect(sessionLineage(list("root", { root }), "draft")).toEqual([]);
    expect(sessionLineage(list("root", { root }), "")).toEqual([]);
    expect(sessionLineage(list("missing", { root }), "missing")).toEqual([]);
  });
  it("stops at missing ancestors and cycles without inventing a title", () => {
    expect(sessionLineage(list("child", { child }), "child")).toHaveLength(1);
    expect(sessionLineage(list("child", { child, parent: { ...parent, parentId: "child" } }), "child")).toHaveLength(2);
  });
  it("does not interpret ordinary fork parent metadata as subagent ancestry", () => {
    const fork = { id: "fork", displayTitle: "Fork", origin: "user", parentId: "parent" };
    expect(sessionLineage(list("fork", { fork, parent, root }), "fork")).toEqual([
      { id: "fork", displayTitle: "Fork", current: true },
    ]);
  });
  it("updates on title changes and on the current/ancestor role", () => {
    const before = sessionLineage(list("child", { child, parent, root }), "child");
    const after = sessionLineage(list("child", { child: { ...child, displayTitle: "Renamed" }, parent, root }), "child");
    expect(equalSessionLineage(before, after)).toBe(false);
    expect(equalSessionLineage(before, before.map(x => ({ ...x })))).toBe(true);
    expect(equalSessionLineage(before, before.map(x => ({ ...x, current: !x.current })))).toBe(false);
  });
});
