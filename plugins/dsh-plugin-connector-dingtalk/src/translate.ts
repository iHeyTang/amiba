import { z } from "zod";
import type { ConnectorInboundEnvelope } from "@amiba/dsh-plugin-connector-core";

/**
 * DingTalk connector configuration.
 */
export interface DingtalkConnectorConfig {
  clientId: string;
  clientSecret: string;
  /**
   * Id of a card template pre-designed in the DingTalk developer console's
   * card platform designer, used to send native interactive approval cards
   * (see approval-card.ts / provider.ts's `createCard`). A card template is
   * a design-time artifact the DingTalk OpenAPI has no way to create on the
   * fly — there is no config-form UI for it (task 4's wizard work item is
   * only the shared "approval-wait" field, not this), so it can only be set
   * by hand-editing a connect's stored config today. Absent (the common
   * case) means `requestApproval` always resolves `null` and every approval
   * on this connect goes through messaging-core's text protocol instead —
   * see the "card API" section of task-4-report.md for why this is the
   * honest default rather than a guessed-at template id.
   */
  approvalCardTemplateId?: string;
}

/**
 * Zod schema for validating DingtalkConnectorConfig.
 */
export const dingtalkConfigSchema = z.object({
  clientId: z.string().min(1, "clientId is required"),
  clientSecret: z.string().min(1, "clientSecret is required"),
  approvalCardTemplateId: z.string().min(1).optional(),
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
  senderNick?: string;
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

    if (typeof record.senderNick === "string" && record.senderNick.trim()) {
      envelope.metadata = { senderName: record.senderNick.trim() };
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

/** The decision a card-button click carries — mirrors messaging-core's
 * `ApprovalDecision` structurally (this plugin doesn't depend on
 * `@amiba/dsh-plugin-messaging-core` directly, same reasoning as
 * `DingtalkInboundTranslation` above never importing connector-core's
 * envelope types by name where a structural literal will do). */
export type DingtalkApprovalDecision = "allowed-once" | "rejected";

/** Result of translating one Stream Mode `TOPIC_CARD` callback frame into
 * the approval decision it carries. */
export interface DingtalkCardCallback {
  readonly approvalId: string;
  readonly decision: DingtalkApprovalDecision;
  /** Who clicked, as a staff userId — the same identity space
   * `translateRobotMessage` prefers for an inbound envelope's `sender`
   * (`senderStaffId`), which is what lets `provider.ts` check it against the
   * prompt's `canAnswer`. Absent when the frame carries no `userId`; the
   * gate then refuses, since an unidentified clicker can never be shown to
   * be on an allowlist. */
  readonly operatorUserId?: string;
  /** The card instance the click landed on, when the frame names one — the
   * same `outTrackId` `realDingtalkDeps.createCard` wrote. Cross-checked
   * against the instance this connect actually created for that approval,
   * so a click replayed against some other card cannot settle it. */
  readonly outTrackId?: string;
  /** The conversation the click came from, when the frame names one.
   * Cross-checked against the conversation the card was created into: a
   * card in chat A must never settle an approval raised in chat B. */
  readonly conversationKey?: string;
}

/**
 * Translates a DingTalk Stream Mode card-callback frame (topic
 * `TOPIC_CARD`, `/v1.0/card/instances/callback`) into the approval decision
 * one of our own two buttons carries.
 *
 * Totally safe: never throws. Returns null for any malformed input or any
 * frame that isn't one of OUR OWN approval-card button clicks.
 *
 * **Unverified wire shape** — see approval-card.ts's and provider.ts's
 * `createCard` doc comments, and task-4-report.md's "card API" section: the
 * installed `dingtalk-stream@2.1.6-beta.1` SDK types `TOPIC_CARD` as a
 * callback-topic constant only (`dist/constants.d.ts`) with no accompanying
 * payload shape — unlike `RobotTextMessage` for `TOPIC_ROBOT`, there is no
 * `CardCallback`-style interface anywhere in the package, and the DingTalk
 * OpenAPI card-callback docs (open.dingtalk.com) are a client-rendered SPA
 * that neither `curl` nor an automated fetch could extract a literal JSON
 * schema from. This function therefore reads OUR OWN convention — a flat
 * `params` string map on the callback frame carrying back exactly the two
 * keys `provider.ts`'s `createCard` wrote into the card's `cardParamMap`
 * (`approvalId`, `decision`) — rather than a field DingTalk's platform is
 * confirmed to produce verbatim. `userId`, if present, is read as the
 * clicking operator's staff id (the same field name `translateRobotMessage`
 * above reads off `RobotMessageBase.senderStaffId`-adjacent frames elsewhere
 * in DingTalk's own APIs). A real DingTalk app is required to confirm or
 * correct this against a live callback.
 *
 * @param raw The raw callback frame's `data`, already `JSON.parse`d by the
 *   caller (mirrors `translateRobotMessage`'s calling convention).
 * @returns The translated decision, or null if unparseable/not ours.
 */
export function translateCardCallback(raw: unknown): DingtalkCardCallback | null {
  try {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return null;
    }
    const record = raw as Record<string, unknown>;

    const params = record.params;
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      return null;
    }
    const paramRecord = params as Record<string, unknown>;

    const approvalId = paramRecord.approvalId;
    if (typeof approvalId !== "string" || approvalId === "") {
      return null;
    }

    const decision = paramRecord.decision;
    if (decision !== "allowed-once" && decision !== "rejected") {
      return null;
    }

    const result: {
      approvalId: string;
      decision: DingtalkApprovalDecision;
      operatorUserId?: string;
      outTrackId?: string;
      conversationKey?: string;
    } = {
      approvalId,
      decision,
    };
    const userId = record.userId;
    if (typeof userId === "string" && userId !== "") {
      result.operatorUserId = userId;
    }
    // Both cross-check fields are OPTIONAL on the way in (the frame shape is
    // unverified — see this function's doc comment) and are only ever used
    // to REFUSE a mismatch in `provider.ts`, never to admit one: a frame
    // that carries neither still has to match on `approvalId`, whose card
    // instance was created into exactly one conversation.
    const outTrackId = record.outTrackId;
    if (typeof outTrackId === "string" && outTrackId !== "") {
      result.outTrackId = outTrackId;
    }
    const conversationKey =
      record.openConversationId ?? record.conversationId;
    if (typeof conversationKey === "string" && conversationKey !== "") {
      result.conversationKey = conversationKey;
    }
    return result;
  } catch {
    // Final backstop: any unexpected error returns null.
    return null;
  }
}
