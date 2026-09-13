import { describe, expect, it } from "vitest";
import type { ImageAttachmentRef } from "@amiba/extension-sdk";

import {
  findSnapshotAssistant,
  settleStreamingMessage,
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
  it("retains image-only Host messages and deduplicates their durable identity", () => {
    const images = [{ attachment: {
      attachmentId: "durable-image" as ImageAttachmentRef["attachmentId"],
      mediaType: "image/png" as const, bytes: 123, width: 12, height: 34,
    } }];
    const message = { uiId: "dsh:photo", content: "", images };
    const next = withHostUserMessage([], message);
    expect(next).toHaveLength(1);
    expect(next[0]?.images).toBe(images);
    expect(withHostUserMessage(next, message)).toBe(next);
  });

  it("appends the message with its plugin attribution", () => {
    const next = withHostUserMessage([], {
      uiId: "dsh:m1",
      content: "去查一下",
      sentAt: 1_725_000_000_000,
      origin: { kind: "plugin", plugin: "amiba-steward" },
    });
    expect(next).toEqual([
      {
        uiId: "dsh:m1",
        role: "user",
        content: "去查一下",
        sentAt: 1_725_000_000_000,
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

describe("settleStreamingMessage", () => {
  it("stops the named bubble spinning without altering its text", () => {
    // The displaced host turn keeps running on the host; stamping
    // "[stopped]" onto partial text would be a claim that vanishes on the
    // next history read.
    const next = settleStreamingMessage(existing, "host_1");
    expect(next).toEqual([
      existing[0],
      { uiId: "host_1", role: "assistant", content: "on it", streaming: false },
    ]);
  });

  it("is a no-op for an unknown id or an already-settled bubble", () => {
    expect(settleStreamingMessage(existing, "host_missing")).toBe(existing);
    const settled = settleStreamingMessage(existing, "host_1");
    expect(settleStreamingMessage(settled, "host_1")).toBe(settled);
  });
});


describe("snapshot assistant identity", () => {
  it("recognizes a durable row for the same runtime turn, including turn zero", () => {
    expect(findSnapshotAssistant([
      { uiId: "user", role: "user", content: "hello" },
      { uiId: "dsh:turn:7", role: "assistant", content: "partial", runtimeTurn: 0 },
    ], { assistantUiId: "ephemeral", runtimeTurn: 0 })).toBe(1);
  });
  it("does not confuse repeated text or missing identities with the current turn", () => {
    const rows: UiMessage[] = [{ uiId: "old", role: "assistant", content: "same", runtimeTurn: 3 }];
    expect(findSnapshotAssistant(rows, { assistantUiId: "new", runtimeTurn: 4 })).toBe(-1);
    expect(findSnapshotAssistant(rows, { assistantUiId: "new" })).toBe(-1);
  });
  it("recognizes a stable message ID and prefers an existing engine row", () => {
    const rows: UiMessage[] = [
      { uiId: "durable", role: "assistant", content: "partial", assistantMessageId: "host-id" },
      { uiId: "engine", role: "assistant", content: "live" },
    ];
    expect(findSnapshotAssistant(rows, { assistantUiId: "new", assistantMessageId: "host-id" })).toBe(0);
    expect(findSnapshotAssistant(rows, { assistantUiId: "engine", assistantMessageId: "host-id" })).toBe(1);
  });
});
