import { z } from "zod";
import type { ConnectorInboundEnvelope } from "@amiba/dsh-plugin-connector-core";

/**
 * Lark/Feishu connector configuration.
 */
export interface LarkConnectorConfig {
  appId: string;
  appSecret: string;
  domain: "feishu" | "lark";
}

/**
 * Zod schema for validating LarkConnectorConfig.
 */
export const larkConfigSchema = z.object({
  appId: z.string().min(1, "appId is required"),
  appSecret: z.string().min(1, "appSecret is required"),
  domain: z.enum(["feishu", "lark"]),
});

/**
 * Lark/Feishu im.message.receive_v1 event payload subset.
 */
export interface LarkReceiveEvent {
  sender?: {
    sender_id?: {
      open_id?: string;
    };
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id?: {
        open_id?: string;
      };
      name?: string;
    }>;
  };
}

/**
 * Translates a Lark/Feishu im.message.receive_v1 event to a ConnectorInboundEnvelope.
 *
 * Totally safe: never throws. Returns null for any malformed or invalid input.
 *
 * Rules:
 * 1. p2p text → envelope with sender and conversation
 * 2. group text with bot mention → envelope with bot mention stripped from text
 * 3. group text without bot mention → null (dropped)
 * 4. non-text message_type → null
 * 5. malformed JSON content or empty text after stripping → null
 * 6. missing sender open_id → envelope without sender key (not undefined)
 *
 * @param event The Lark/Feishu event (any shape)
 * @param botOpenId The bot's open_id to check for mentions
 * @returns The translated envelope, or null if dropped or invalid
 */
export function translateReceiveEvent(
  event: LarkReceiveEvent,
  botOpenId: string,
): Omit<ConnectorInboundEnvelope, "sender"> & { sender?: string } | null {
  try {
    // Shape guard: event must be a non-null object
    if (typeof event !== "object" || event === null) {
      return null;
    }

    const eventRecord = (event as unknown) as Record<string, unknown>;
    const messageObj = eventRecord.message;

    // Shape guard: message must be a non-null object
    if (typeof messageObj !== "object" || messageObj === null) {
      return null;
    }

    const message = messageObj as Record<string, unknown>;

    // Shape guard: required string fields
    const messageId = message.message_id;
    const chatId = message.chat_id;
    const chatType = message.chat_type;
    const messageType = message.message_type;
    const content = message.content;

    if (
      typeof messageId !== "string" ||
      typeof chatId !== "string" ||
      typeof chatType !== "string" ||
      typeof messageType !== "string" ||
      typeof content !== "string"
    ) {
      return null;
    }

    // Rule 4: Only text messages
    if (messageType !== "text") {
      return null;
    }

    // Rule 5: Parse JSON content
    let contentObj: unknown;
    try {
      contentObj = JSON.parse(content);
    } catch {
      return null;
    }

    if (typeof contentObj !== "object" || contentObj === null) {
      return null;
    }

    const contentRecord = contentObj as Record<string, unknown>;
    if (!("text" in contentRecord)) {
      return null;
    }

    const rawText = contentRecord.text;
    if (typeof rawText !== "string") {
      return null;
    }

    let text: string = rawText;

    // Rule 2/3: Handle group messages with bot mentions
    if (chatType === "group") {
      // Shape guard: mentions must be absent or an array
      const mentionsObj = message.mentions;
      let mentions: unknown[] = [];
      if (mentionsObj !== undefined && mentionsObj !== null) {
        if (!Array.isArray(mentionsObj)) {
          // Non-array mentions → treat as absent
          mentions = [];
        } else {
          mentions = mentionsObj;
        }
      }

      // Check if bot is mentioned
      const botMentioned = mentions.some((mention) => {
        if (typeof mention !== "object" || mention === null) {
          return false;
        }
        const mentionRecord = mention as Record<string, unknown>;
        const idObj = mentionRecord.id;
        if (typeof idObj !== "object" || idObj === null) {
          return false;
        }
        const idRecord = idObj as Record<string, unknown>;
        return idRecord.open_id === botOpenId;
      });

      if (!botMentioned) {
        // Rule 3: Drop group messages without bot mention
        return null;
      }

      // Rule 2: Strip mention placeholders from text
      for (const mention of mentions) {
        if (typeof mention !== "object" || mention === null) {
          continue;
        }
        const mentionRecord = mention as Record<string, unknown>;
        const key = mentionRecord.key;
        if (typeof key === "string") {
          text = text.replace(new RegExp(`${escapeRegex(key)}\\s*`, "g"), " ");
        }
      }
    }

    // Rule 5: Collapse whitespace and trim
    text = text.replace(/\s+/g, " ").trim();

    // Rule 5: Empty text is invalid
    if (text === "") {
      return null;
    }

    // Rule 6: Get sender if available
    const senderObj = eventRecord.sender;
    let sender: string | undefined;
    if (typeof senderObj === "object" && senderObj !== null) {
      const senderRecord = senderObj as Record<string, unknown>;
      const senderIdObj = senderRecord.sender_id;
      if (typeof senderIdObj === "object" && senderIdObj !== null) {
        const senderIdRecord = senderIdObj as Record<string, unknown>;
        const openId = senderIdRecord.open_id;
        if (typeof openId === "string") {
          sender = openId;
        }
      }
    }

    // Build envelope
    const envelope: Omit<ConnectorInboundEnvelope, "sender"> & {
      sender?: string;
    } = {
      id: messageId,
      text,
      conversation: {
        key: chatId,
        kind: chatType === "p2p" ? "p2p" : "group",
      },
    };

    if (sender) {
      (envelope as ConnectorInboundEnvelope).sender = sender;
    }

    return envelope;
  } catch {
    // Final backstop: any unexpected error returns null
    return null;
  }
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
