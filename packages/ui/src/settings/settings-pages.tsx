import {
  Activity,
  FileText,
  Keyboard,
  Palette,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { MessageKey } from "@amiba/i18n";

import { SettingsLogs } from "./SettingsLogs";
import { SettingsAppearance, SettingsShortcuts } from "./SettingsPreferences";
import { SettingsStatus } from "./SettingsStatus";

export interface SettingsPageProps {
  detail?: string;
  onOpenDetail: (id: string | null) => void;
  /**
   * Ledger of DSH plugin-owned agent-preset detail sections (M1 contribution
   * slot). No registry page consumes this anymore — the agents page moved to
   * dsh-plugin-agent-preset, which reads the ledger itself — but the
   * threading stays as a generic mechanism for future registry pages.
   * Defaulted (absent) so existing callers/tests keep passing.
   */
  presetSections?: readonly { id: string; label: string }[];
  /** Render target for one preset-section ledger entry, scoped by profileId. */
  renderPresetSection?: (
    sectionId: string,
    owner: { profileId: string },
  ) => ReactNode;
}

export interface SettingsPageDescriptor {
  id: string;
  icon: LucideIcon;
  titleKey: MessageKey;
  group: "general" | "assistant" | "advanced";
  component: ComponentType<SettingsPageProps>;
  desktopOnly?: boolean;
  scroll?: "page" | "self";
}

/**
 * Registry-local adapter: existing page components don't accept
 * SettingsPageProps yet (they take no props, or unrelated optional props).
 * Wrapping here — instead of changing the components — keeps this task
 * scoped to routing/layout; Tasks 6-8 migrate the components themselves and
 * drop these wrappers.
 */
function page(Component: ComponentType): ComponentType<SettingsPageProps> {
  return function RegistryPage(_props: SettingsPageProps) {
    return <Component />;
  };
}

/**
 * Single source for the settings navigation, head titles, and routing.
 * Adding a page = adding one entry here; the scaffold provides its layout.
 */
export const SETTINGS_PAGES: readonly SettingsPageDescriptor[] = [
  {
    id: "appearance",
    icon: Palette,
    titleKey: "options.nav.appearance",
    group: "general",
    component: page(SettingsAppearance),
  },
  {
    id: "shortcuts",
    icon: Keyboard,
    titleKey: "options.nav.shortcuts",
    group: "general",
    component: page(SettingsShortcuts),
    desktopOnly: true,
  },
  // The Assistant group's rows are all DSH plugin-owned settings sections
  // now (智能体预设 from dsh-plugin-agent-preset — the 行为与人设 page merged
  // into it as the pinned default-preset row — 模型与服务 from
  // dsh-plugin-model-plane, …) — projected through the section ledger, not
  // registered here.
  {
    id: "status",
    icon: Activity,
    titleKey: "options.nav.status",
    group: "advanced",
    component: page(SettingsStatus),
  },
  {
    id: "logs",
    icon: FileText,
    titleKey: "options.nav.logs",
    group: "advanced",
    component: page(SettingsLogs),
  },
];

export function settingsPageById(
  id: string,
): SettingsPageDescriptor | undefined {
  return SETTINGS_PAGES.find((entry) => entry.id === id);
}
