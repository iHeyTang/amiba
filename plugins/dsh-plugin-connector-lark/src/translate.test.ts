import { describe, it, expect } from "vitest";
import {
  translateReceiveEvent,
  type LarkReceiveEvent,
} from "./translate.js";

describe("translateReceiveEvent", () => {
  const botOpenId = "ou_bot_123";

  // Rule 1: p2p text message
  it("translates p2p text message to envelope with sender and conversation", () => {
    const event: LarkReceiveEvent = {
      sender: {
        sender_id: {
          open_id: "ou_user_1",
        },
      },
      message: {
        message_id: "msg_123",
        chat_id: "oc_p2p_456",
        chat_type: "p2p",
        message_type: "text",
        content: '{"text":"hello world"}',
      },
    };

    const result = translateReceiveEvent(event, botOpenId);
    expect(result).toEqual({
      id: "msg_123",
      text: "hello world",
      sender: "ou_user_1",
      conversation: {
        key: "oc_p2p_456",
        kind: "p2p",
      },
    });
  });

  // Rule 2: group text message with bot mention
  it("strips mention placeholders for bot mention from group text message", () => {
    const event: LarkReceiveEvent = {
      sender: {
        sender_id: {
          open_id: "ou_user_2",
        },
      },
      message: {
        message_id: "msg_234",
        chat_id: "oc_group_789",
        chat_type: "group",
        message_type: "text",
        content: '{"text":"@_user_1 hello @_bot_123 world"}',
        mentions: [
          {
            key: "@_bot_123",
            id: {
              open_id: "ou_bot_123",
            },
            name: "Amiba",
          },
        ],
      },
    };

    const result = translateReceiveEvent(event, botOpenId);
    expect(result).toEqual({
      id: "msg_234",
      text: "@_user_1 hello world",
      sender: "ou_user_2",
      conversation: {
        key: "oc_group_789",
        kind: "group",
      },
    });
  });

  // Rule 3: group message with NO bot mention
  it("returns null for group message without bot mention", () => {
    const event: LarkReceiveEvent = {
      sender: {
        sender_id: {
          open_id: "ou_user_3",
        },
      },
      message: {
        message_id: "msg_345",
        chat_id: "oc_group_999",
        chat_type: "group",
        message_type: "text",
        content: '{"text":"hello world"}',
        mentions: [
          {
            key: "@_user_1",
            id: {
              open_id: "ou_user_1",
            },
            name: "User One",
          },
        ],
      },
    };

    const result = translateReceiveEvent(event, botOpenId);
    expect(result).toBeNull();
  });

  // Rule 4: non-text message_type
  it("returns null for non-text message_type", () => {
    const event: LarkReceiveEvent = {
      sender: {
        sender_id: {
          open_id: "ou_user_4",
        },
      },
      message: {
        message_id: "msg_456",
        chat_id: "oc_p2p_000",
        chat_type: "p2p",
        message_type: "image",
        content: '{"image_key":"img_123"}',
      },
    };

    const result = translateReceiveEvent(event, botOpenId);
    expect(result).toBeNull();
  });

  // Rule 5: malformed JSON content or empty text
  it("returns null for malformed JSON content", () => {
    const event: LarkReceiveEvent = {
      sender: {
        sender_id: {
          open_id: "ou_user_5",
        },
      },
      message: {
        message_id: "msg_567",
        chat_id: "oc_p2p_111",
        chat_type: "p2p",
        message_type: "text",
        content: "not json",
      },
    };

    const result = translateReceiveEvent(event, botOpenId);
    expect(result).toBeNull();
  });

  it("returns null for empty text after stripping", () => {
    const event: LarkReceiveEvent = {
      sender: {
        sender_id: {
          open_id: "ou_user_6",
        },
      },
      message: {
        message_id: "msg_678",
        chat_id: "oc_group_222",
        chat_type: "group",
        message_type: "text",
        content: '{"text":"@_bot_123"}',
        mentions: [
          {
            key: "@_bot_123",
            id: {
              open_id: "ou_bot_123",
            },
            name: "Amiba",
          },
        ],
      },
    };

    const result = translateReceiveEvent(event, botOpenId);
    expect(result).toBeNull();
  });

  // Rule 6: missing sender open_id
  it("returns envelope without sender key when sender open_id is missing", () => {
    const event: LarkReceiveEvent = {
      message: {
        message_id: "msg_789",
        chat_id: "oc_p2p_333",
        chat_type: "p2p",
        message_type: "text",
        content: '{"text":"hello world"}',
      },
    };

    const result = translateReceiveEvent(event, botOpenId);
    expect(result).toEqual({
      id: "msg_789",
      text: "hello world",
      conversation: {
        key: "oc_p2p_333",
        kind: "p2p",
      },
    });
    expect(result).not.toHaveProperty("sender");
  });

  // Totality: must handle malformed input without throwing
  it("returns null for null event (never throws)", () => {
    const result = translateReceiveEvent(null as unknown as LarkReceiveEvent, botOpenId);
    expect(result).toBeNull();
  });

  it("returns null for undefined event (never throws)", () => {
    const result = translateReceiveEvent(undefined as unknown as LarkReceiveEvent, botOpenId);
    expect(result).toBeNull();
  });

  it("returns null for empty object event (never throws)", () => {
    const result = translateReceiveEvent({} as unknown as LarkReceiveEvent, botOpenId);
    expect(result).toBeNull();
  });

  it("returns null when message is null (never throws)", () => {
    const result = translateReceiveEvent(
      { message: null } as unknown as LarkReceiveEvent,
      botOpenId,
    );
    expect(result).toBeNull();
  });

  it("returns null when required string fields are missing (never throws)", () => {
    const result = translateReceiveEvent(
      {
        message: {
          message_id: 123, // wrong type
          chat_id: "oc_123",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"hello"}',
        },
      } as unknown as LarkReceiveEvent,
      botOpenId,
    );
    expect(result).toBeNull();
  });

  it("returns null when mentions is not an array (never throws)", () => {
    const event = {
      sender: {
        sender_id: {
          open_id: "ou_user_7",
        },
      },
      message: {
        message_id: "msg_890",
        chat_id: "oc_group_333",
        chat_type: "group",
        message_type: "text",
        content: '{"text":"hello world"}',
        mentions: "not-an-array", // wrong type
      },
    };

    const result = translateReceiveEvent(event as unknown as LarkReceiveEvent, botOpenId);
    expect(result).toBeNull();
  });
});
