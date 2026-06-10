import "~lib/platform/init";

import "~style.css";

import { SettingsView } from "@amiba/ui";

import { chromeOptionsCapabilities } from "~lib/options/chrome-capabilities";

/**
 * Extension Options page — thin wrapper around the shared <SettingsView/>.
 *
 * All 9 settings panes (Status, Preferences, Scripts, Gateway, Models, Skills,
 * Memory, Cron, Logs) live in `@amiba/settings-ui`. The extension provides
 * the chrome.runtime-backed OptionsCapabilities (Bridge refresh + userscript
 * CRUD); desktop omits them so the Scripts tab + Bridge refresh are absent
 * automatically.
 */
export default function Options() {
  return <SettingsView capabilities={chromeOptionsCapabilities} />;
}
