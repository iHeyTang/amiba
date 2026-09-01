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
 * Rules:
 * 1. p2p text → envelope with sender and conversation
 * 2. group text with bot mention → envelope with bot mention stripped from text
 * 3. group text without bot mention → null (dropped)
 * 4. non-text message_type → null
 * 5. malformed JSON content or empty text after stripping → null
 * 6. missing sender open_id → envelope without sender key (not undefined)
 *
 * @param event The Lark/Feishu event
 * @param botOpenId The bot's open_id to check for mentions
 * @returns The translated envelope, or null if dropped
 */
export function translateReceiveEvent(
  event: LarkReceiveEvent,
  botOpenId: string,
): Omit<ConnectorInboundEnvelope, "sender"> & { sender?: string } | null {
  const message = event.message;

  // Rule 4: Only text messages
  if (message.message_type !== "text") {
    return null;
  }

  // Rule 5: Parse JSON content
  let contentObj: unknown;
  try {
    contentObj = JSON.parse(message.content);
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
  if (message.chat_type === "group") {
    // Check if bot is mentioned
    const botMentioned =
      message.mentions?.some(
        (mention) => mention.id?.open_id === botOpenId,
      ) ?? false;

    if (!botMentioned) {
      // Rule 3: Drop group messages without bot mention
      return null;
    }

    // Rule 2: Strip mention placeholders from text
    if (message.mentions) {
      for (const mention of message.mentions) {
        // Only strip the bot's mention and other user mentions, not the text itself
        if (mention.key) {
          text = text.replace(new RegExp(`${escapeRegex(mention.key)}\\s*`, "g"), " ");
        }
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
  const sender = event.sender?.sender_id?.open_id;

  // Build envelope
  const envelope: Omit<ConnectorInboundEnvelope, "sender"> & {
    sender?: string;
  } = {
    id: message.message_id,
    text,
    conversation: {
      key: message.chat_id,
      kind: message.chat_type === "p2p" ? "p2p" : "group",
    },
  };

  if (sender) {
    (envelope as ConnectorInboundEnvelope).sender = sender;
  }

  return envelope;
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
