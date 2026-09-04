import { describe, expect, it } from "vitest";

import {
  withHostAssistantPlaceholder,
  withHostUserMessage,
} from "../host-turn-messages";
import type { UiMessage } from "../types";

const existing: UiMessage[] = [
  { uiId: "dsh:m1", role: "user", content: "去查一下" },
  { uiId: "host_1", role: "assistant", content: "on it", streaming: true },
];

describe("withHostAssistantPlaceholder", () => {
  it("opens a streaming bubble for a turn no local submit prepared", () => {
    const next = withHostAssistantPlaceholder([existing[0]!], "host_1");
    expect(next).toEqual([
      existing[0],
      { uiId: "host_1", role: "assistant", content: "", streaming: true },
    ]);
  });

  it("leaves the list untouched when the bubble already exists", () => {
    expect(withHostAssistantPlaceholder(existing, "host_1")).toBe(existing);
  });
});

describe("withHostUserMessage", () => {
  it("appends the message with its plugin attribution", () => {
    const next = withHostUserMessage([], {
      uiId: "dsh:m1",
      content: "去查一下",
      origin: { kind: "plugin", plugin: "amiba-steward" },
    });
    expect(next).toEqual([
      {
        uiId: "dsh:m1",
        role: "user",
        content: "去查一下",
        origin: { kind: "plugin", plugin: "amiba-steward" },
      },
    ]);
  });

  it("is a no-op when history already delivered the same id", () => {
    // The live bridge and the durable projection mint the same `uiId`, so a
    // tab switch mid-turn cannot produce the message twice.
    expect(
      withHostUserMessage(existing, { uiId: "dsh:m1", content: "去查一下" }),
    ).toBe(existing);
  });
});
