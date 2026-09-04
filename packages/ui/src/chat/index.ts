export { default as ChatSurface, type ChatSurfaceProps } from "./ChatSurface";
export {
  default as FullScreenChatView,
  type FullScreenChatViewProps,
} from "./FullScreenChatView";
export {
  SessionTitleProvider,
  useSessionTitle,
  useSetSessionTitle,
} from "./useSessionTitle";
export type {
  PendingPromptAttachment,
  PendingPromptCapability,
  PendingPromptResult,
  WorkspaceInspectorCapability,
  ChatSurfaceCapabilities,
} from "./internal/capabilities";
export {
  WorkspacePane,
  WorkspacePaneProvider,
  WorkspacePaneToggle,
  useWorkspacePane,
  type WorkspacePaneResource,
} from "./WorkspacePane";
export { TabBar } from "./TabBar";
export {
  WorkspaceControl,
  type WorkspaceControlProps,
} from "./WorkspaceControl";
export { SessionDrawer } from "./SessionDrawer";
export {
  partitionSessionGroups,
  resolveBadgeTexts,
  resolveMenuItems,
  type SessionBadgeSource,
  type SessionBadgeTarget,
  type SessionListGroup,
  type SessionListGroupBucket,
  type SessionListGroupPartition,
  type SessionListMenuItem,
} from "./session-list-extensions";
export {
  WallpaperBackdrop,
  WallpaperCredit,
  wallpaperAmbientTextClass,
} from "./Wallpaper";
export { MessageList } from "./MessageList";
export {
  Composer,
  type ComposerDensity,
  type ComposerHandle,
  type ComposerModelPickerRenderer,
  type ComposerModelPickerRequest,
  type ComposerPickerOverlayVariant,
  type ComposerPlanSeatRenderer,
  type ComposerProps,
} from "./Composer";
export { ComposerNotice, type ComposerNoticeProps } from "./ComposerNotice";
export { ComposerKbdHints, Kbd, type ComposerKbdHint } from "./Kbd";
export {
  AttachmentButton,
  ATTACHMENT_INPUT_ACCEPT,
  useComposerAttachments,
  type AttachmentButtonProps,
  type UseComposerAttachmentsOptions,
  type UseComposerAttachmentsResult,
} from "./useComposerAttachments";
export {
  queueChatPrompt,
  useChatSessionRequester,
  type ChatSessionRequest,
  type ChatSessionMode,
} from "./chat-session-request";

// Bubble + helpers (the visual identity of the chat surface).
export {
  Bubble,
  MessageTurns,
  UserStickyBubble,
  type BubbleProps,
} from "./bubble/Bubble";
export {
  AgentDestinationChip,
  AttachmentBadgeView,
  AttachmentChip,
  EmptyState,
  ErrorBlock,
  KindIcon,
  type AgentDestinationChipProps,
  type AttachmentBadgeViewProps,
  type AttachmentChipProps,
  type EmptyStateProps,
  type ErrorBlockProps,
  type KindIconProps,
} from "./bubble/chips";
export { ToolChip, ToolProgressChips } from "./bubble/tool-chip";
export {
  ToolCallSeatProvider,
  useToolCallSeat,
  type ToolCallSeatRenderer,
  type ToolCallSeatRequest,
} from "./bubble/tool-call-seat";
export {
  QuestionSeat,
  type QuestionSeatRenderer,
  type QuestionSeatRequest,
} from "./bubble/question-seat";
export {
  toolCallBlockFromProgress,
  toolCallBlockName,
} from "./bubble/tool-call-block";
export {
  ApprovalBanner,
  ApprovalCountdownBar,
  ApprovalRecordChip,
  ApprovalRecordList,
  presentApprovalDescription,
  type ApprovalBannerProps,
} from "./bubble/approval";
export { ApprovalCode, splitApprovalCommand } from "./bubble/approval-syntax";

// Re-export UI message shape + helpers so consumers can build a UiMessage[]
// to pass into <MessageTurns> / <Bubble>.
export type {
  AssistantTimelineItem,
  ChatError,
  MessagesMaxWidth,
  UiMessage,
} from "./internal/types";
export {
  CAPPED_HEIGHT_CLASS,
  CAPPED_HEIGHT_PX,
  EXPANDED_MAX_HEIGHT_CLASS,
  COMPOSER_TEXTAREA_MAX_PX,
} from "./internal/types";
export {
  bubbleTextContent,
  formatToolDuration,
  hostnameOf,
  splitThinkingFromBody,
} from "./internal/helpers";

// Composer mention providers — host apps build TriggerProviders, pass them via
// <ChatSurface mentionProviders={…}>, and reuse insertMentionAtTrigger inside
// their own onSelect handlers.
export { insertMentionAtTrigger } from "./composer/providers/skills";
export { makeWorkspaceFilesProvider } from "./workspace-files-provider";
export type {
  TriggerProvider,
  TriggerHitContext,
  MenuItem,
  MentionData,
  MentionType,
} from "./composer/providers/types";

// The OFFICIAL input-trigger pipeline, as the DSH plugin host consumes it.
//
// `officialTriggerSources()` is what the host registers with
// `ctx.inputTriggers.registerSource`; `OfficialTriggerMenu` and
// `CommandPopup` are the two components the host puts into the shadowed
// `conversation.input.overlay` cells (`slash-menu` and `command-popup`,
// `priority: -1`). `ComposerTriggerRuntime` is the face the host implements
// and hands back to `<Composer triggerRuntime={…}>`.
export { OfficialTriggerMenu } from "./composer/triggers/OfficialTriggerMenu";
export { CommandPopup, filterOptions } from "./composer/triggers/CommandPopup";
export type { CommandPopupController } from "./composer/triggers/CommandPopup";
export {
  TRIGGER_SOURCE_LABELS,
  localTriggerSources,
  officialTriggerSources,
} from "./composer/providers/dsh-sources";
export type {
  ComposerTriggerController,
  ComposerTriggerRuntime,
  TriggerEditorOps,
} from "./composer/triggers/contracts";
