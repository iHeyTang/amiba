import { expect, it } from "vitest";
import { commandRowOwners } from "./command-rows.js";

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
