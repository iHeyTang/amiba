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
});
