import { expect, it, vi } from "vitest";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";

import type { ConversationSnapshot } from "./conversation-snapshot.js";
import { createConversationRowsSource } from "./conversation-rows-source.js";

/** Minimal hand-driven sources: the shell owns both of them in production. */
function fakeSource<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    snapshot: {
      getSnapshot: () => value,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as ObservableSnapshot<T>,
    publish(next: T) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function conversation(commandId: string, seq: number) {
  const command = { kind: "command", name: "probe", args: "", commandId, outcome: null };
  const node = { key: commandId, kind: "command", data: command, anchorSeq: seq, visibility: "visible" };
  return {
    chat: {
      order: [commandId],
      nodes: new Map([[commandId, node]]),
      timeline: { turnOrder: [], turns: new Map() },
    },
    sessionId: "s1",
  } as unknown as ConversationSnapshot;
}

const renderCommandRow = (owner: { node: { name?: string } }) => `row:${owner.node.name}`;

it("caches its snapshot between publications so React reads one reference per render", () => {
  const source = fakeSource<ConversationSnapshot | undefined>(conversation("c1", 1));
  const keys = fakeSource<readonly string[]>(["probe"]);
  const rows = createConversationRowsSource(source.snapshot, keys.snapshot, renderCommandRow as never);

  const first = rows.getSnapshot();
  // React calls getSnapshot more than once per render and requires the same
  // reference while nothing changed, or it re-renders forever.
  expect(rows.getSnapshot()).toBe(first);
  expect(first.timelineRows.map(row => [row.id, row.replaceMessageId])).toEqual([
    ["c1", "dsh:command:c1:result"],
  ]);
  expect(first.timelineRows[0].content).toBe("row:probe");
});

it("republishes when the projection moves and stays put for an unchanged one", () => {
  const first = conversation("c1", 1);
  const source = fakeSource<ConversationSnapshot | undefined>(first);
  const keys = fakeSource<readonly string[]>(["probe"]);
  const rows = createConversationRowsSource(source.snapshot, keys.snapshot, renderCommandRow as never);

  const before = rows.getSnapshot();
  source.publish(conversation("c2", 2));
  expect(rows.getSnapshot()).not.toBe(before);
  const after = rows.getSnapshot();
  source.publish(source.snapshot.getSnapshot());
  expect(rows.getSnapshot()).toBe(after);
});

it("wakes its listener for both the projection and the registered-name set", () => {
  const source = fakeSource<ConversationSnapshot | undefined>(conversation("c1", 1));
  const keys = fakeSource<readonly string[]>(["probe"]);
  const rows = createConversationRowsSource(source.snapshot, keys.snapshot, renderCommandRow as never);
  const listener = vi.fn();
  const off = rows.subscribe(listener);

  source.publish(conversation("c2", 2));
  keys.publish(["probe", "other"]);
  expect(listener).toHaveBeenCalledTimes(2);

  off();
  source.publish(conversation("c3", 3));
  expect(listener).toHaveBeenCalledTimes(2);
});

it("filters out rows whose command name no plugin registered", () => {
  const source = fakeSource<ConversationSnapshot | undefined>(conversation("c1", 1));
  const keys = fakeSource<readonly string[]>(["something-else"]);
  const rows = createConversationRowsSource(source.snapshot, keys.snapshot, renderCommandRow as never);

  expect(rows.getSnapshot().timelineRows).toEqual([]);
});
