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
  type PluginLanguage,
  type PluginTranslateFn,
} from "@amiba/i18n/plugin";
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
export { Textarea } from "./primitives/textarea";
export {
  NavigationGroupLabel,
  NavigationRow,
} from "./navigation/NavigationRow";
export {
  SettingsPageActionButton,
  SettingsPageActions,
  SettingsPageDescription,
} from "./settings/page-chrome";
export {
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelSettingsSectionHeader,
} from "./settings/ModelSettingsSectionChrome";
export { useRefetchOnFocus } from "./hooks/useRefetchOnFocus";
export {
  ChipSwitcher,
  Heatmap,
  type ChipSwitcherProps,
  type HeatmapCellBase,
  type HeatmapProps,
} from "./viz";
