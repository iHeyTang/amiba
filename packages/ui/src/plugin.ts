/**
 * Client-safe visual surface for DSH browser plugins.
 *
 * Keep this entry free of platform adapters, Electron bridges, and Amiba's
 * application React contexts. DSH Client plugins run in the official Web
 * Shell React tree and may only share visual primitives and DOM contracts.
 */
export {
  usePluginT,
  type PluginLanguage,
  type PluginTranslateFn,
} from "@amiba/i18n/plugin";
export { Button } from "./primitives/button";
export { cn } from "./primitives/cn";
export { PageContent } from "./primitives/page-content";
export { ScrollArea } from "./primitives/scroll-area";
export {
  NavigationGroupLabel,
  NavigationRow,
} from "./navigation/NavigationRow";
export {
  SettingsPageActions,
  SettingsPageDescription,
} from "./settings/page-chrome";
