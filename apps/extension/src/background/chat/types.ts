/**
 * Wire protocol + runtime-state types for the background chat engine.
 *
 * The protocol shapes themselves live in `@hermes-x/core` so the desktop
 * Electron-IPC engine can use the same shapes. This file just re-exports
 * them under the legacy names the extension code uses, plus the extension-
 * specific `CHAT_PORT_NAME` (the chrome.runtime.Port channel name).
 */

export {
  type SubmitPayload,
  type AssistantTimelineItem,
  type ChatRuntimeError,
  type ChatRuntimeState,
  type SnapshotFrame,
  type StreamEvent,
  type HermesApprovalRequest,
  // Back-compat: existing code imports `ClientToBgMessage` / `BgToClientMessage`.
  type ClientToEngineMessage as ClientToBgMessage,
  type EngineToClientMessage as BgToClientMessage,
} from "@hermes-x/core";

/** chrome.runtime.Port channel name used by the extension side panel. */
export const CHAT_PORT_NAME = "hermes-chat";
