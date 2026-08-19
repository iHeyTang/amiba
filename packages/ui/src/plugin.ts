/**
 * Client-safe visual surface for DSH browser plugins.
 *
 * Keep this entry free of platform adapters, Electron bridges, and Amiba's
 * application React contexts. DSH Client plugins run in the official Web
 * Shell React tree and may only share visual primitives and DOM contracts.
 */
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
  DialogTitle,
} from "./primitives/dialog";
export { Input } from "./primitives/input";
export { Label } from "./primitives/label";
export { PageContent } from "./primitives/page-content";
export { PaneHeaderBar } from "./navigation/PaneHeaderBar";
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
