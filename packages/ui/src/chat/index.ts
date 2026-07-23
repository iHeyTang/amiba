export { ChatView, type ChatViewProps } from "./ChatView"
export {
  default as ChatSurface,
  type ChatSurfaceProps,
} from "./ChatSurface"
export {
  default as FullScreenChatView,
  type FullScreenChatViewProps,
} from "./FullScreenChatView"
export { ScheduledTasksPage } from "./ScheduledTasksPage"
export {
  SessionTitleProvider,
  useSessionTitle,
  useSetSessionTitle,
} from "./useSessionTitle"
export type {
  ActiveTabInfo,
  BrowserTabSnapshot,
  LearnCapability,
  LearnStatus,
  LearnTraceResult,
  NavigateOpenPolicy,
  NavigateOpenPolicyCapability,
  PageContextCapability,
  PageContextSnapshot,
  PendingPromptAttachment,
  PendingPromptCapability,
  PendingPromptResult,
  ChatSurfaceCapabilities,
} from "./internal/capabilities"
export { TabBar } from "./TabBar"
export { ChannelChip } from "./internal/ChannelChip"
export { SessionDrawer } from "./SessionDrawer"
export {
  WallpaperBackdrop,
  WallpaperCredit,
  wallpaperAmbientTextClass,
} from "./Wallpaper"
export { MessageList } from "./MessageList"
export { Composer, type ComposerHandle, type ComposerProps } from "./Composer"
export {
  ComposerKbdHints,
  Kbd,
  type ComposerKbdHint,
} from "./Kbd"
export {
  QuickActionChips,
  type QuickActionChipsProps,
} from "./QuickActionChips"
export {
  AttachmentButton,
  ATTACHMENT_INPUT_ACCEPT,
  useComposerAttachments,
  type AttachmentButtonProps,
  type UseComposerAttachmentsOptions,
  type UseComposerAttachmentsResult,
} from "./useComposerAttachments"
export {
  useVoiceRecorder,
  MicrophoneButton,
  type UseVoiceRecorderOptions,
  type VoiceRecorder,
  type MicrophoneButtonProps,
} from "./useVoiceRecorder"
export {
  queueChatPrompt,
  useChatSessionRequester,
  type ChatSessionRequest,
  type ChatSessionMode,
} from "./chat-session-request"

// Bubble + helpers (the visual identity of the chat surface).
export { Bubble, MessageTurns, UserStickyBubble, type BubbleProps } from "./bubble/Bubble"
export {
  AgentDestinationChip,
  AttachmentBadgeView,
  AttachmentChip,
  EmptyState,
  ErrorBlock,
  KindIcon,
  PageChip,
  type AgentDestinationChipProps,
  type AttachmentBadgeViewProps,
  type AttachmentChipProps,
  type EmptyStateProps,
  type ErrorBlockProps,
  type KindIconProps,
  type PageChipProps
} from "./bubble/chips"
export { ToolChip, ToolProgressChips } from "./bubble/tool-chip"
export {
  ApprovalBanner,
  ApprovalCountdownBar,
  ApprovalRecordChip,
  ApprovalRecordList,
  type ApprovalBannerProps
} from "./bubble/approval"

// Re-export UI message shape + helpers so consumers can build a UiMessage[]
// to pass into <MessageTurns> / <Bubble>.
export type {
  AssistantTimelineItem,
  ChatError,
  MessagesMaxWidth,
  UiMessage
} from "./internal/types"
export {
  CAPPED_HEIGHT_CLASS,
  CAPPED_HEIGHT_PX,
  EXPANDED_MAX_HEIGHT_CLASS,
  COMPOSER_TEXTAREA_MAX_PX
} from "./internal/types"
export {
  bubbleTextContent,
  formatToolDuration,
  hostnameOf,
  splitThinkingFromBody
} from "./internal/helpers"

// Composer mention providers — host apps build TriggerProviders, pass them via
// <ChatSurface mentionProviders={…}>, and reuse insertMentionAtTrigger inside
// their own onSelect handlers.
export { insertMentionAtTrigger } from "./composer/providers/skills"
export type {
  TriggerProvider,
  MenuItem,
  MentionData,
  MentionType,
} from "./composer/providers/types"
