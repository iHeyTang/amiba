/**
 * Client-safe visual surface for DSH browser plugins.
 *
 * Keep this entry free of platform adapters, Electron bridges, and Amiba's
 * application React contexts. DSH Client plugins run in the official Web
 * Shell React tree and may only share visual primitives and DOM contracts.
 *
 * The one line below the barrel is `import type`: several components exported
 * here (`ModelSummary`, `ModelPickerDialog`, `ModelInfoCard`) call `useT()`
 * for their built-in strings, and `MessageKey` is the union of exactly the
 * dictionary owners a program can see. Without the merge those calls would
 * not compile in a plugin's program. It is erased before any bundler sees it,
 * so it does not put the dictionary in a plugin bundle — see
 * `./locales/index.ts`.
 */
import type {} from "./locales/keys";
export { EmbeddedPage } from "./primitives/embedded-page";
export { REFERENCE_EVENT, referenceHref, type ReferenceRequest } from "./reference-request";

export {
  usePluginT,
  type MessageKey,
  type PluginCatalogOverlay,
  type PluginLanguage,
  type PluginTranslateFn,
} from "@amiba/i18n/plugin";
export { Badge } from "./primitives/badge";
export { Button } from "./primitives/button";
export { cn } from "./primitives/cn";
export { CollectionState } from "./primitives/collection-state";
export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DIALOG_MOTION_MS,
  DialogTitle,
} from "./primitives/dialog";
export { WizardFrame, type WizardFrameProps, type WizardTab } from "./primitives/wizard-frame";
// The ONE container for anything docked above the composer (approvals,
// questions, errors). A plugin occupying the `amiba.conversation.question`
// seat renders INSIDE it, never in a card of its own.
export {
  ComposerDockSheet,
  type ComposerDockSheetProps,
  type ComposerDockTone,
} from "./chat/ComposerDockSheet";
// Session-list extension points: a plugin's `amiba.sessions.list.group` /
// `amiba.sessions.item.menu` inject face is typed against
// `SessionListItemTarget`; the pure helpers are exported so a plugin's own
// tests can exercise its `claim`/`visible` predicates without the shell.
export {
  matchesSessionQuery,
  partitionSessionGroups,
  resolveMenuItems,
  type SessionListGroup,
  type SessionListGroupBucket,
  type SessionListGroupPartition,
  type SessionListItemTarget,
  type SessionListMenuItem,
} from "./chat/session-list-extensions";
export { Input } from "./primitives/input";
export { Label } from "./primitives/label";
export { PageContent } from "./primitives/page-content";
export { PaneHeaderBar } from "./navigation/PaneHeaderBar";
export {
  ToolRowFrame,
  type ToolRowFrameProps,
} from "./chat/bubble/tool-row-frame";
export {
  CodeEvidence,
  DiffEvidence,
  EvidenceShell,
  StructuredEvidence,
  TerminalEvidence,
  TodoEvidence,
  decodeToolResult,
  hostnameOf,
  oneline,
  recordOf,
  stringValue,
  toolResultText,
  unwrapUntrustedToolResult,
} from "./chat/bubble/tool-evidence";
export {
  toolCallArgs,
  toolCallDurationMs,
  toolCallErrorCode,
  toolCallFailed,
  toolCallResultText,
  toolCallSettled,
  toolCallStartedAt,
} from "./chat/bubble/tool-call-block";
export { ScrollArea } from "./primitives/scroll-area";
export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./primitives/select";
export { Switch } from "./primitives/switch";
export { Textarea } from "./primitives/textarea";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./primitives/tooltip";
export {
  NavigationGroupLabel,
  NavigationRow,
} from "./navigation/NavigationRow";
export { WorkspaceNavigationRow, type WorkspaceNavigationRowProps, type WorkspaceNavigationTarget } from "./navigation/WorkspaceNavigationRow";
export { SidebarExpandControl } from "./navigation/SidebarExpandControl";
// SettingsPageChromeProvider/useSettingsPageChrome are the scaffold-side
// half of the actions contract. Plugins normally render only
// SettingsPageActions (the SettingsView scaffold provides the context), but
// plugin test suites mount them to reproduce the scaffold's head host.
export {
  SettingsPageActionButton,
  SettingsPageActions,
  SettingsPageChromeProvider,
  SettingsPageDescription,
  useSettingsPageChrome,
} from "./settings/page-chrome";
export {
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelSettingsSectionHeader,
} from "./settings/ModelSettingsSectionChrome";
// Model-plane surfaces shared with the plugin's settings section and its
// composer slot contribution. ModelPickerDialog/ModelSummary read the host
// catalog via `useT()` for their built-in strings — acceptable here because
// those keys are host vocabulary until the MP-T4 purge decides their fate;
// the contribution's own strings ride its plugin-local overlay.
export { ModelIcon } from "./models/ModelIcon";
export { ModelIdentityName } from "./models/ModelSummary";
export { ModelInfoCard } from "./models/ModelInfoCard";
export {
  ModelPickerDialog,
  type ModelPickerGroup,
  type ModelPickerOption,
  type ModelPickerStatus,
} from "./models/ModelPickerDialog";
export { type ModelMetadata } from "./models/model-metadata";
export { useRefetchOnFocus } from "./hooks/useRefetchOnFocus";
export {
  ChipSwitcher,
  Heatmap,
  type ChipSwitcherProps,
  type HeatmapCellBase,
  type HeatmapProps,
} from "./viz";
export {
  Popover,
  PopoverContent,
  PopoverTrigger,
  type DialogOverlayVariant,
} from "./primitives";

export { SemanticToolRow, type SemanticToolSpec, type SemanticEvidenceContext } from "./chat/bubble/semantic-tool-row";
export { MarkdownCodeView, MarkdownTableView } from "./primitives/markdown-blocks";

export { WorkbenchExtensionsProvider, WorkbenchViewBoundary } from "./chat/workbench-extensions";
export { builtinWorkbenchViews, WorkspaceFileWorkspace, CodeEditor, PreviewHeader, useWorkspacePane, type FileResource } from "./chat/WorkspacePane";

export { ModelDetailsDialog } from "./models/ModelDetailsDialog";

export { EmptyStateVisualProvider, type EmptyStateVisualRenderer } from "./primitives/empty-state-visual";

export { PresentationRoot, usePresentationCoordinator, useSurfaceActivity, useSurfaceInteraction } from "./primitives/interaction-region";
