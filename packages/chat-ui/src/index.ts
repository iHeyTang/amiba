export { ChatView, type ChatViewProps } from "./ChatView"
export {
  default as SidePanelView,
  type SidePanelViewProps,
} from "./SidePanelView"
export {
  default as FullScreenChatView,
  type FullScreenChatViewProps,
} from "./FullScreenChatView"
export type {
  ActiveTabInfo,
  LearnCapability,
  LearnStatus,
  LearnTraceResult,
  NavigateOpenPolicy,
  NavigateOpenPolicyCapability,
  PageContextCapability,
  PageContextSnapshot,
  PendingPromptCapability,
  SidePanelCapabilities,
} from "./internal/capabilities"
export { TabBar } from "./TabBar"
export { SessionDrawer } from "./SessionDrawer"
export { MessageList } from "./MessageList"
export { Composer } from "./Composer"

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
