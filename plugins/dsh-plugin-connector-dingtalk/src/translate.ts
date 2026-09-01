import { z } from "zod";
import type { ConnectorInboundEnvelope } from "@amiba/dsh-plugin-connector-core";

/**
 * DingTalk connector configuration.
 */
export interface DingtalkConnectorConfig {
  clientId: string;
  clientSecret: string;
  enableTools: boolean;
}

/**
 * Zod schema for validating DingtalkConnectorConfig.
 */
export const dingtalkConfigSchema = z.object({
  clientId: z.string().min(1, "clientId is required"),
  clientSecret: z.string().min(1, "clientSecret is required"),
  enableTools: z.boolean().default(false),
});

/**
 * DingTalk Stream Mode robot-message payload subset (verified against the
 * installed `dingtalk-stream` package's `dist/constants.d.ts`: `RobotMessage`
 * / `RobotTextMessage`). Every field here is optional even though the SDK's
 * own `RobotMessageBase` types them as required strings/numbers — the actual
 * payload arrives as `unknown` (JSON.parsed from the downstream socket
 * frame's `data` string by the caller) and must be shape-guarded
 * defensively rather than trusted at the type level.
 */
export interface DingtalkRobotMessage {
  msgId?: string;
  msgtype?: string;
  text?: { content?: string };
  conversationId?: string;
  conversationType?: string;
  senderStaffId?: string;
  senderId?: string;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
}

/**
 * Result of translating a DingTalk robot message: the ConnectorInboundEnvelope
 * plus the per-message webhook reply target carried alongside it. These
 * webhook fields are NOT part of the envelope itself — the provider runtime
 * (Task 2) peels them off, stores them per-conversation, and hands the bare
 * envelope to `handle.onInbound`.
 */
export interface DingtalkInboundTranslation {
  envelope: ConnectorInboundEnvelope;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
}

/**
 * Translates a DingTalk Stream Mode robot message to a
 * DingtalkInboundTranslation.
 *
 * Totally safe: never throws. Returns null for any malformed or non-text
 * input.
 *
 * Rules:
 * 1. p2p text (`conversationType === "1"`) -> envelope with sender and
 *    conversation; the sessionWebhook/expiry ride alongside the envelope,
 *    not inside it.
 * 2. group text (`conversationType === "2"`, or anything other than the
 *    literal "1") -> kind "group". Unlike Lark, DingTalk's platform only
 *    ever delivers a GROUP message to the robot when it was @-mentioned
 *    (a platform-side gate), so no bot-mention check is performed here.
 * 3. non-text msgtype -> null.
 * 4. missing/empty msgId, conversationId, or content-after-trim -> null.
 * 5. totality: null/undefined/non-object input, or any field holding the
 *    wrong shape/type, returns null and never throws (try/catch backstop).
 * 6. sessionWebhook absent -> translation is still valid, with the field
 *    omitted rather than set to undefined.
 *
 * @param msg The raw DingTalk robot message (any shape, already JSON.parsed)
 * @returns The translated result, or null if dropped or invalid
 */
export function translateRobotMessage(msg: unknown): DingtalkInboundTranslation | null {
  try {
    // Shape guard: msg must be a non-null object.
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
      return null;
    }

    const record = msg as Record<string, unknown>;

    // Rule 3: only text messages are translated.
    if (record.msgtype !== "text") {
      return null;
    }

    // Rule 4: required identity fields.
    const msgId = record.msgId;
    const conversationId = record.conversationId;
    if (
      typeof msgId !== "string" ||
      msgId === "" ||
      typeof conversationId !== "string" ||
      conversationId === ""
    ) {
      return null;
    }

    // Shape guard: text.content must be a string.
    const textObj = record.text;
    if (typeof textObj !== "object" || textObj === null) {
      return null;
    }
    const rawContent = (textObj as Record<string, unknown>).content;
    if (typeof rawContent !== "string") {
      return null;
    }

    // DingTalk's platform already strips the @-mention placeholder from
    // text.content before delivering a group message to the robot (unlike
    // Lark, which leaves the mention key in the text for the handler to
    // strip itself). A plain trim removes only the leading/trailing
    // whitespace that stripping can leave behind.
    const text = rawContent.trim();
    if (text === "") {
      // Rule 4: empty content after trim.
      return null;
    }

    // Rule 2: any conversationType other than the literal "1" is "group" —
    // deliberately not gated on a bot mention, since the platform already
    // filters which group messages ever reach the robot.
    const conversationType = record.conversationType;
    const kind: "p2p" | "group" = conversationType === "1" ? "p2p" : "group";

    const senderStaffId = record.senderStaffId;
    const senderId = record.senderId;
    let sender: string | undefined;
    if (typeof senderStaffId === "string" && senderStaffId !== "") {
      sender = senderStaffId;
    } else if (typeof senderId === "string" && senderId !== "") {
      sender = senderId;
    }

    const envelope: ConnectorInboundEnvelope = {
      id: msgId,
      text,
      conversation: {
        key: conversationId,
        kind,
      },
    };
    if (sender !== undefined) {
      envelope.sender = sender;
    }

    const translation: DingtalkInboundTranslation = { envelope };

    // Rule 6: sessionWebhook/expiry ride alongside, omitted when absent.
    const sessionWebhook = record.sessionWebhook;
    if (typeof sessionWebhook === "string" && sessionWebhook !== "") {
      translation.sessionWebhook = sessionWebhook;
    }
    const sessionWebhookExpiredTime = record.sessionWebhookExpiredTime;
    if (typeof sessionWebhookExpiredTime === "number") {
      translation.sessionWebhookExpiredTime = sessionWebhookExpiredTime;
    }

    return translation;
  } catch {
    // Final backstop: any unexpected error returns null.
    return null;
  }
}
