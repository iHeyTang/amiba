import { describe, expect, it } from "vitest";

import {
  createMessageSourcesSource,
  messageSourceLabelResolver,
} from "./message-source.js";
import type {
  SlotContributionEntry,
  SlotContributionsCtx,
} from "./session-list-sources.js";

/** A fake `ctx.slots` good enough to drive the source without DSH. */
function fakeSlots(entries: SlotContributionEntry[]): SlotContributionsCtx {
  return {
    getVersion: () => 0,
    entriesOfSlot: () => entries,
    subscribe: () => () => {},
  };
}

describe("createMessageSourcesSource", () => {
  it("projects id + label registrations, sorted by order, with no inject face", () => {
    const source = createMessageSourcesSource(
      fakeSlots([
        { options: { id: "amiba-im", order: 2, label: "IM" } },
        { options: { id: "amiba-steward", order: 1, label: "大管家" } },
      ]),
    );
    expect(source.getSnapshot()).toEqual([
      { id: "amiba-steward", order: 1, label: "大管家" },
      { id: "amiba-im", order: 2, label: "IM" },
    ]);
  });

  it("falls back to the id as the label, and drops an entry with no id", () => {
    const source = createMessageSourcesSource(
      fakeSlots([{ options: { id: "" } }, { options: { id: "amiba-cron" } }]),
    );
    expect(source.getSnapshot()).toEqual([
      { id: "amiba-cron", order: 0, label: "amiba-cron" },
    ]);
  });
});

describe("messageSourceLabelResolver", () => {
  it("resolves a registered id and leaves an unregistered one undefined", () => {
    const resolve = messageSourceLabelResolver([
      { id: "amiba-steward", order: 0, label: "大管家" },
    ]);
    expect(resolve("amiba-steward")).toBe("大管家");
    expect(resolve("amiba-unknown")).toBeUndefined();
  });

  it("keeps the lowest-order registration when two claim the same id", () => {
    const resolve = messageSourceLabelResolver([
      { id: "dup", order: 0, label: "first" },
      { id: "dup", order: 1, label: "second" },
    ]);
    expect(resolve("dup")).toBe("first");
  });
});
