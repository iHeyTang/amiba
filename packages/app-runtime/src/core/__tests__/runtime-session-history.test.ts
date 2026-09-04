import { describe, expect, it } from "vitest";

import { projectRuntimeSessionHistory } from "../runtime-session-history";
import { splitFileAttachmentsFromPrompt } from "../attachments/format";

describe("projectRuntimeSessionHistory", () => {
  it("folds a DSH event log into one assistant row per turn", () => {
    const messages = projectRuntimeSessionHistory([
      { event: { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } } },
      {
        event: {
          type: "user/message",
          seq: 1,
          time: 2,
          data: {
            id: "u1",
            source: { kind: "user" },
            content: [{ type: "text", text: "inspect" }],
          },
        },
      },
      {
        event: {
          type: "tool/call",
          seq: 2,
          time: 3,
          data: { callId: "c1", name: "read", arguments: '{"path":"a"}' },
        },
      },
      {
        event: {
          type: "tool/result",
          seq: 3,
          time: 8,
          data: {
            message: {
              toolCallId: "c1",
              content: [{ type: "text", text: "ok" }],
            },
          },
        },
      },
      {
        event: {
          type: "assistant/message",
          seq: 4,
          time: 9,
          data: {
            message: { content: [{ type: "text", text: "done" }] },
          },
        },
      },
      {
        event: {
          type: "turn/end",
          seq: 5,
          time: 10,
          data: { turn: 1, reason: { kind: "completed" } },
        },
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "inspect" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "done",
      toolProgress: [
        {
          tool: "read",
          toolCallId: "c1",
          status: "completed",
          args: { path: "a" },
          durationMs: 5,
        },
      ],
    });
  });

  it("completes tools from the real DSH wire shape (source.callId + nested tool-result)", () => {
    const messages = projectRuntimeSessionHistory([
      { event: { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } } },
      {
        event: {
          type: "tool/call",
          seq: 1,
          time: 100,
          data: { callId: "call_00_x", name: "bash", arguments: "{}" },
        },
      },
      {
        event: {
          type: "tool/result",
          seq: 2,
          time: 350,
          data: {
            turn: 1,
            step: 1,
            message: {
              role: "tool",
              id: "m1",
              source: { kind: "tool", callId: "call_00_x" },
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call_00_x",
                  content: [{ type: "text", text: "total 240" }],
                },
              ],
            },
          },
        },
      },
      {
        event: {
          type: "assistant/message",
          seq: 3,
          time: 400,
          data: { message: { content: [{ type: "text", text: "done" }] } },
        },
      },
      {
        event: {
          type: "turn/end",
          seq: 4,
          time: 500,
          data: { turn: 1, reason: { kind: "completed" } },
        },
      },
    ]);

    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant?.toolProgress).toMatchObject([
      {
        toolCallId: "call_00_x",
        status: "completed",
        durationMs: 250,
        result: { text: "total 240" },
      },
    ]);
  });

  it("projects DSH command-plane lifecycle records without inventing a model turn", () => {
    const messages = projectRuntimeSessionHistory([
      {
        event: {
          type: "command/run",
          seq: 1,
          time: 1,
          data: { commandId: "cmd-1", name: "plan", args: " inspect auth" },
        },
      },
      {
        event: {
          type: "command/done",
          seq: 2,
          time: 2,
          data: { commandId: "cmd-1", kind: "success", text: "Plan mode enabled" },
        },
      },
    ]);

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "/plan inspect auth" }),
      expect.objectContaining({ role: "assistant", content: "Plan mode enabled" }),
    ]);
  });

  it("strips the attachment envelope back into badges and the user's own text", () => {
    // Byte-shape taken from a real session log: DSH's admission path prepends
    // this preamble and block into the SAME text block as what the user typed
    // ("这是什么"), so a reloaded transcript showed the wire format as if the
    // user had written it.
    const envelope = [
      "The user attached the following file. Raster image bytes are included",
      "as native image content. For text or PDF content, use the matching",
      "attachment_read_text / attachment_read_pdf tool when relevant.",
      "",
      "<file-attachment>",
      'Name: "image.png"',
      'Kind: "image"',
      'Mime: "image/png"',
      "Size: 49242 bytes",
      'Attachment-ID: "att_f0412054e4db47489595189f8ae8d916"',
      "</file-attachment>",
      "",
      "这是什么",
    ].join("\n");
    const { text, badges } = splitFileAttachmentsFromPrompt(envelope);
    expect(text).toBe("这是什么");
    expect(badges).toEqual([
      {
        uiId: "att_f0412054e4db47489595189f8ae8d916",
        name: "image.png",
        mime: "image/png",
        size: 49242,
        kind: "image",
        attachmentId: "att_f0412054e4db47489595189f8ae8d916",
      },
    ]);
  });

  it("passes text without a well-formed envelope through byte-for-byte", () => {
    // A user legitimately PASTING the marker must not have their words eaten.
    const pasted =
      "look at this: <file-attachment>\nnot the real shape\n</file-attachment> ok?";
    expect(splitFileAttachmentsFromPrompt(pasted)).toEqual({
      text: pasted,
      badges: [],
    });
    expect(splitFileAttachmentsFromPrompt("这是什么")).toEqual({
      text: "这是什么",
      badges: [],
    });
  });

  it("projects a reloaded attachment message as badges plus the typed text", () => {
    const messages = projectRuntimeSessionHistory([
      {
        event: {
          type: "user/message",
          seq: 1,
          time: 2,
          data: {
            id: "u1",
            source: { kind: "user" },
            content: [
              {
                type: "text",
                text:
                  "The user attached the following file. Raster image bytes are included\n" +
                  "as native image content. For text or PDF content, use the matching\n" +
                  "attachment_read_text / attachment_read_pdf tool when relevant.\n\n" +
                  "<file-attachment>\n" +
                  'Name: "image.png"\n' +
                  'Kind: "image"\n' +
                  'Mime: "image/png"\n' +
                  "Size: 49242 bytes\n" +
                  'Attachment-ID: "att_1"\n' +
                  "</file-attachment>\n\n" +
                  "这是什么",
              },
              { type: "image", attachment: { attachmentId: "sha256:x" } },
            ],
          },
        },
      },
    ] as never);
    const user = messages.find((message) => message.role === "user");
    expect(user?.content).toBe("这是什么");
    expect(user?.attachmentBadges?.map((badge) => badge.name)).toEqual([
      "image.png",
    ]);
  });

  it("projects the two-part wire format: metadata part to badges, text part to words", () => {
    const messages = projectRuntimeSessionHistory([
      {
        event: {
          type: "user/message",
          seq: 1,
          time: 2,
          data: {
            id: "u1",
            source: { kind: "user" },
            content: [
              {
                type: "text",
                text:
                  "<file-attachment>\n" +
                  'Name: "image.png"\n' +
                  'Kind: "image"\n' +
                  'Mime: "image/png"\n' +
                  "Size: 49242 bytes\n" +
                  'Attachment-ID: "att_1"\n' +
                  "</file-attachment>",
              },
              { type: "text", text: "这是什么" },
              { type: "image", attachment: { attachmentId: "sha256:x" } },
            ],
          },
        },
      },
    ] as never);
    const user = messages.find((message) => message.role === "user");
    expect(user?.content).toBe("这是什么");
    expect(user?.attachmentBadges?.map((badge) => badge.name)).toEqual([
      "image.png",
    ]);
  });

  it("strips an attachment envelope from a plugin-relayed message too", () => {
    // Same cleaning the live bridge applies — see the bridge's own test,
    // which asserts the identical text off the identical wire shape.
    const messages = projectRuntimeSessionHistory([
      {
        event: {
          type: "user/message",
          seq: 1,
          time: 2,
          data: {
            id: "m1",
            source: { kind: "plugin", plugin: "amiba-im", form: "relay" },
            content: [
              {
                type: "text",
                text:
                  "<file-attachment>\n" +
                  'Name: "shot.png"\n' +
                  'Kind: "image"\n' +
                  'Mime: "image/png"\n' +
                  "Size: 12 bytes\n" +
                  'Attachment-ID: "att_9"\n' +
                  "</file-attachment>\n\n" +
                  "看看这个",
              },
            ],
          },
        },
      },
    ] as never);
    expect(messages[0]?.content).toBe("看看这个");
    expect(messages[0]?.attachmentBadges?.map((badge) => badge.name)).toEqual([
      "shot.png",
    ]);
  });

  function pluginUserMessage(source: Record<string, unknown>) {
    return [
      {
        event: {
          type: "user/message",
          seq: 4,
          time: 2,
          data: {
            id: "m1",
            source,
            content: [{ type: "text", text: "帮我看下这个任务" }],
          },
        },
      },
    ] as never;
  }

  it("keeps a plugin-relayed user message and attributes it to the plugin", () => {
    const messages = projectRuntimeSessionHistory(
      pluginUserMessage({
        kind: "plugin",
        plugin: "amiba-steward",
        form: "relay",
      }),
    );
    expect(messages).toEqual([
      {
        role: "user",
        content: "帮我看下这个任务",
        origin: { kind: "plugin", plugin: "amiba-steward" },
        uiId: "dsh:m1",
        runtimeSeq: 4,
      },
    ]);
  });

  it("drops a plugin notice and a plugin message with no form: injected context, not conversation", () => {
    // A guard's `notice` (repeat-tool-reminder's "you are repeating the same
    // call") and an undeclared-form injection are model context. DSH's own
    // transcript shows them as collapsed context rows, never as the user
    // speaking; rendering them as attributed user bubbles put a plugin's
    // words in the person's mouth.
    for (const source of [
      { kind: "plugin", plugin: "repeat-tool-reminder", form: "notice", summary: "x × 3" },
      { kind: "plugin", plugin: "amiba-im" },
    ]) {
      expect(projectRuntimeSessionHistory(pluginUserMessage(source))).toEqual(
        [],
      );
    }
  });

  it("still drops injected model context and tool results", () => {
    for (const source of [
      { kind: "plugin", plugin: "dsh-agent-instructions", form: "instructions" },
      { kind: "plugin", plugin: "dsh-tool-goal", form: "catalog" },
      { kind: "plugin", plugin: "dsh-time-context", form: "snapshot" },
      { kind: "plugin", plugin: "dsh-session-reference", form: "recall" },
      { kind: "tool", callId: "c1" },
    ]) {
      expect(projectRuntimeSessionHistory(pluginUserMessage(source))).toEqual(
        [],
      );
    }
  });

  it("drops a plugin message with no plugin name, exactly as the bridge does", () => {
    // `plugin` is required by the DSH source type: a message that cannot say
    // who produced it must not be passed off as the user's own words, and
    // keeping it here would make it appear on reload but never live.
    expect(
      projectRuntimeSessionHistory(
        pluginUserMessage({ kind: "plugin", form: "relay" }),
      ),
    ).toEqual([]);
  });

  it("leaves a message the person typed unattributed", () => {
    const messages = projectRuntimeSessionHistory(
      pluginUserMessage({ kind: "user" }),
    );
    expect(messages[0]?.origin).toBeUndefined();
  });
});
