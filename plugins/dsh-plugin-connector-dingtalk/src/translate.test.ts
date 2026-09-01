import { describe, it, expect } from "vitest";
import { translateRobotMessage } from "./translate.js";

describe("translateRobotMessage", () => {
  // Rule 1: p2p text message
  it("translates p2p text message to envelope with sender, conversation, and webhook fields alongside", () => {
    const msg = {
      msgId: "msg_123",
      msgtype: "text",
      text: { content: "  hello world  " },
      conversationId: "cid_p2p_456",
      conversationType: "1",
      senderStaffId: "staff_1",
      senderId: "uid_1",
      sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=abc",
      sessionWebhookExpiredTime: 1893456000000,
    };

    const result = translateRobotMessage(msg);
    expect(result).toEqual({
      envelope: {
        id: "msg_123",
        text: "hello world",
        sender: "staff_1",
        conversation: {
          key: "cid_p2p_456",
          kind: "p2p",
        },
      },
      sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=abc",
      sessionWebhookExpiredTime: 1893456000000,
    });
  });

  it("falls back to senderId when senderStaffId is absent", () => {
    const msg = {
      msgId: "msg_124",
      msgtype: "text",
      text: { content: "hi" },
      conversationId: "cid_p2p_457",
      conversationType: "1",
      senderId: "uid_2",
    };

    const result = translateRobotMessage(msg);
    expect(result?.envelope.sender).toBe("uid_2");
  });

  it("omits the sender key when neither senderStaffId nor senderId is present", () => {
    const msg = {
      msgId: "msg_125",
      msgtype: "text",
      text: { content: "hi" },
      conversationId: "cid_p2p_458",
      conversationType: "1",
    };

    const result = translateRobotMessage(msg);
    expect(result?.envelope).toEqual({
      id: "msg_125",
      text: "hi",
      conversation: { key: "cid_p2p_458", kind: "p2p" },
    });
    expect(result?.envelope).not.toHaveProperty("sender");
  });

  // Rule 2: group text message
  it("translates group text message (conversationType 2) to envelope with kind group", () => {
    const msg = {
      msgId: "msg_234",
      msgtype: "text",
      text: { content: "hello from the group" },
      conversationId: "cid_group_789",
      conversationType: "2",
      senderStaffId: "staff_2",
    };

    const result = translateRobotMessage(msg);
    expect(result).toEqual({
      envelope: {
        id: "msg_234",
        text: "hello from the group",
        sender: "staff_2",
        conversation: {
          key: "cid_group_789",
          kind: "group",
        },
      },
    });
  });

  it("treats any conversationType other than the literal \"1\" as group (no bot-mention gate)", () => {
    const msg = {
      msgId: "msg_235",
      msgtype: "text",
      text: { content: "no gate needed, the platform already filtered this" },
      conversationId: "cid_group_790",
      conversationType: "some-future-value",
    };

    const result = translateRobotMessage(msg);
    expect(result?.envelope.conversation.kind).toBe("group");
  });

  it("trims a leading whitespace artifact left behind by the platform's mention stripping", () => {
    const msg = {
      msgId: "msg_236",
      msgtype: "text",
      text: { content: "  hello team" },
      conversationId: "cid_group_791",
      conversationType: "2",
    };

    const result = translateRobotMessage(msg);
    expect(result?.envelope.text).toBe("hello team");
  });

  // Rule 3: non-text msgtype
  it("returns null for non-text msgtype", () => {
    const msg = {
      msgId: "msg_345",
      msgtype: "richText",
      conversationId: "cid_p2p_999",
      conversationType: "1",
    };

    expect(translateRobotMessage(msg)).toBeNull();
  });

  it("returns null when msgtype is missing", () => {
    const msg = {
      msgId: "msg_346",
      text: { content: "hello" },
      conversationId: "cid_p2p_998",
      conversationType: "1",
    };

    expect(translateRobotMessage(msg)).toBeNull();
  });

  // Rule 4: missing/empty required fields
  it("returns null when msgId is missing", () => {
    const msg = {
      msgtype: "text",
      text: { content: "hello" },
      conversationId: "cid_p2p_997",
      conversationType: "1",
    };

    expect(translateRobotMessage(msg)).toBeNull();
  });

  it("returns null when msgId is empty", () => {
    const msg = {
      msgId: "",
      msgtype: "text",
      text: { content: "hello" },
      conversationId: "cid_p2p_996",
      conversationType: "1",
    };

    expect(translateRobotMessage(msg)).toBeNull();
  });

  it("returns null when conversationId is missing", () => {
    const msg = {
      msgId: "msg_347",
      msgtype: "text",
      text: { content: "hello" },
      conversationType: "1",
    };

    expect(translateRobotMessage(msg)).toBeNull();
  });

  it("returns null when content is empty after trim", () => {
    const msg = {
      msgId: "msg_348",
      msgtype: "text",
      text: { content: "    " },
      conversationId: "cid_p2p_995",
      conversationType: "1",
    };

    expect(translateRobotMessage(msg)).toBeNull();
  });

  // Rule 5: totality — malformed input must never throw
  it("returns null for null input (never throws)", () => {
    expect(translateRobotMessage(null)).toBeNull();
  });

  it("returns null for undefined input (never throws)", () => {
    expect(translateRobotMessage(undefined)).toBeNull();
  });

  it("returns null for an empty object (never throws)", () => {
    expect(translateRobotMessage({})).toBeNull();
  });

  it("returns null for a non-object input (never throws)", () => {
    expect(translateRobotMessage("not an object")).toBeNull();
    expect(translateRobotMessage(42)).toBeNull();
    expect(translateRobotMessage(true)).toBeNull();
    expect(translateRobotMessage(["array", "not", "object"])).toBeNull();
  });

  it("returns null when text is not an object (never throws)", () => {
    const msg = {
      msgId: "msg_349",
      msgtype: "text",
      text: "notobj",
      conversationId: "cid_p2p_994",
      conversationType: "1",
    };

    expect(translateRobotMessage(msg)).toBeNull();
  });

  it("returns null when text.content is not a string (never throws)", () => {
    const msg = {
      msgId: "msg_350",
      msgtype: "text",
      text: { content: 12345 },
      conversationId: "cid_p2p_993",
      conversationType: "1",
    };

    expect(translateRobotMessage(msg)).toBeNull();
  });

  it("returns null when required fields hold numeric/wrong-typed values (never throws)", () => {
    const msg = {
      msgId: 123, // wrong type
      msgtype: "text",
      text: { content: "hello" },
      conversationId: 456, // wrong type
      conversationType: "1",
    };

    expect(translateRobotMessage(msg)).toBeNull();
  });

  it("returns null when text field is missing entirely (never throws)", () => {
    const msg = {
      msgId: "msg_351",
      msgtype: "text",
      conversationId: "cid_p2p_992",
      conversationType: "1",
    };

    expect(translateRobotMessage(msg)).toBeNull();
  });

  // Rule 6: sessionWebhook absent
  it("returns a valid translation with sessionWebhook omitted when absent", () => {
    const msg = {
      msgId: "msg_400",
      msgtype: "text",
      text: { content: "hello" },
      conversationId: "cid_p2p_800",
      conversationType: "1",
    };

    const result = translateRobotMessage(msg);
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("sessionWebhook");
    expect(result).not.toHaveProperty("sessionWebhookExpiredTime");
  });
});
