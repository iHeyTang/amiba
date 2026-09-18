import { describe, expect, it } from "vitest";
import { mergeDurableUserMessages } from "../durable-user-reconcile";
import type { UiMessage } from "../types";

const image = {
  attachment: {
    attachmentId: "sha256:image-bytes",
    mediaType: "image/png" as const,
    bytes: 1234,
    width: 1200,
    height: 800,
  },
};

function user(overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    uiId: "u-draft",
    role: "user",
    content: "prompt",
    ...overrides,
  };
}

const assistant: UiMessage = {
  uiId: "a-live",
  role: "assistant",
  content: "answer",
  streaming: false,
};

describe("mergeDurableUserMessages", () => {
  it("upgrades an optimistic user bubble to its durable twin with images", () => {
    const active = [user({ content: "Send me the file" }), assistant];
    const durable: UiMessage[] = [
      {
        uiId: "dsh:user:1",
        role: "user",
        content: "Send me the file",
        runtimeSeq: 1,
        images: [image],
      },
      assistant,
    ];

    const { messages, changed } = mergeDurableUserMessages(active, durable);

    expect(changed).toBe(true);
    expect(messages[0]).toMatchObject({
      uiId: "dsh:user:1",
      content: "Send me the file",
      runtimeSeq: 1,
      images: [image],
    });
    // The assistant bubble is left untouched.
    expect(messages[1]).toBe(assistant);
  });

  it("preserves optimistic-only extras such as the workspace binding", () => {
    const active = [
      user({ content: "prompt", workspacePath: "/Users/me/project" }),
    ];
    const durable: UiMessage[] = [
      {
        uiId: "dsh:user:2",
        role: "user",
        content: "prompt",
        runtimeSeq: 2,
        images: [image],
        sentAt: 1000,
      },
    ];

    const { messages } = mergeDurableUserMessages(active, durable);

    expect(messages[0]).toMatchObject({
      uiId: "dsh:user:2",
      workspacePath: "/Users/me/project",
      sentAt: 1000,
      images: [image],
    });
  });

  it("leaves a user message untouched when its durable twin has no images", () => {
    const optimistic = user({
      content: "plain text",
      attachmentBadges: [
        {
          uiId: "att:1",
          name: "notes.txt",
          mime: "text/plain",
          size: 12,
          kind: "text",
        },
      ],
    });
    const active = [optimistic];
    const durable: UiMessage[] = [
      {
        uiId: "dsh:user:3",
        role: "user",
        content: "plain text",
        runtimeSeq: 3,
      },
    ];

    const { messages, changed } = mergeDurableUserMessages(active, durable);

    expect(changed).toBe(false);
    expect(messages[0]).toBe(optimistic);
  });

  it("pairs repeated identical prompts with their own turns in order", () => {
    const active = [
      user({ uiId: "u-1", content: "again" }),
      user({ uiId: "u-2", content: "again" }),
    ];
    const durable: UiMessage[] = [
      {
        uiId: "dsh:user:1",
        role: "user",
        content: "again",
        runtimeSeq: 1,
        images: [image],
      },
      {
        uiId: "dsh:user:2",
        role: "user",
        content: "again",
        runtimeSeq: 2,
        images: [image],
      },
    ];

    const { messages } = mergeDurableUserMessages(active, durable);
    expect(messages[0]).toMatchObject({ uiId: "dsh:user:1" });
    expect(messages[1]).toMatchObject({ uiId: "dsh:user:2" });
  });

  it("keeps alignment when notices and plugin rows interleave the turns", () => {
    const notice = {
      uiId: "dsh:notice:1",
      role: "user" as const,
      content: "",
      notice: { summary: "任务汇报：写周报 — 完成" },
    };
    const active = [
      user({ uiId: "u-1", content: "first" }),
      notice,
      user({ uiId: "u-2", content: "second" }),
    ];
    const durable: UiMessage[] = [
      {
        uiId: "dsh:user:1",
        role: "user",
        content: "first",
        runtimeSeq: 1,
        images: [image],
      },
      notice,
      {
        uiId: "dsh:user:2",
        role: "user",
        content: "second",
        runtimeSeq: 2,
        images: [image],
      },
    ];

    const { messages, changed } = mergeDurableUserMessages(active, durable);
    expect(changed).toBe(true);
    expect(messages[0]).toMatchObject({ uiId: "dsh:user:1" });
    expect(messages[1]).toBe(notice);
    expect(messages[2]).toMatchObject({ uiId: "dsh:user:2" });
  });

  it("ignores user messages that are already durable", () => {
    const durableMessage: UiMessage = {
      uiId: "dsh:user:9",
      role: "user",
      content: "loaded",
      runtimeSeq: 9,
      images: [image],
    };
    const active = [durableMessage];

    const { messages, changed } = mergeDurableUserMessages(active, [
      durableMessage,
    ]);

    expect(changed).toBe(false);
    expect(messages[0]).toBe(durableMessage);
  });

  it("no-ops when no durable user messages exist", () => {
    const optimistic = user({ content: "orphan" });
    const { messages, changed } = mergeDurableUserMessages(
      [optimistic],
      [assistant],
    );

    expect(changed).toBe(false);
    expect(messages[0]).toBe(optimistic);
  });
});
