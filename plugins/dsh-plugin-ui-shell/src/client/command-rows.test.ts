import { expect, it } from "vitest";
import { commandRowOwners, commandTimelineRows } from "./command-rows.js";

it("preserves Host command identity and the explicitly projected compaction link", () => {
  const command = { kind: "command", name: "probe", args: "  原始😀", commandId: "c1", outcome: null };
  const compact = { ...command, name: "compact", commandId: "c2", outcome: { kind: "success" } };
  const compaction = { kind: "compaction", seq: 42, summaryEventSeq: 40, summary: "summary" };
  const nodes = new Map([
    ["command", { key: "command", kind: "command", data: command, anchorSeq: 10, visibility: "visible" }],
    ["compact", { key: "compact", kind: "manual-compaction", data: { command: compact, compaction }, anchorSeq: 42, visibility: "visible" }],
    ["hidden", { key: "hidden", kind: "command", data: command, anchorSeq: 9, visibility: "hidden" }],
  ]);
  const result = commandRowOwners({ chat: { order: ["hidden", "missing", "command", "compact"], nodes } } as never);
  expect(result.map(row => [row.id, row.seq])).toEqual([["command", 10], ["compact", 42]]);
  expect(result[0].owner.node).toBe(command);
  expect(result[1].owner.node).toBe(compact);
  expect(result[1].owner.compaction).toBe(compaction);
  expect(commandRowOwners(undefined)).toEqual([]);
});

it("keeps the official goal command echo in the Amiba timeline without an extension renderer", () => {
  const node = { key: 'goal-input', kind: 'command-input', anchorSeq: 3.9, visibility: 'visible', data: { text: '/goal Ship it' } };
  const snapshot = { chat: { order: [node.key], nodes: new Map([[node.key, node]]) } };
  const rows = commandTimelineRows(snapshot as never, [], () => null);
  expect(rows.map(row => [row.id, row.seq])).toEqual([['goal-input', 3.9]]);
  expect(rows[0]!.content).toBeTruthy();
});
