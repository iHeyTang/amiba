import {
  Activity,
  FileText,
  Fingerprint,
  Keyboard,
  Palette,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { MessageKey } from "@amiba/i18n";

import { SettingsAssistantBehavior } from "./AgentBehaviorEditor";
import { SettingsAgentsPage } from "./SettingsAgentsPage";
import { SettingsLogs } from "./SettingsLogs";
import { SettingsAppearance, SettingsShortcuts } from "./SettingsPreferences";
import { SettingsStatus } from "./SettingsStatus";

export interface SettingsPageProps {
  detail?: string;
  onOpenDetail: (id: string | null) => void;
  /**
   * Ledger of DSH plugin-owned agent-preset detail sections (M1 contribution
   * slot). Only the agents page consumes this; every other registry page
   * ignores it. Defaulted (absent) so existing callers/tests keep passing.
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
  {
    id: "behavior",
    icon: Fingerprint,
    titleKey: "options.agents.section.behavior",
    group: "assistant",
    component: page(SettingsAssistantBehavior),
  },
  {
    id: "agents",
    icon: UserRound,
    titleKey: "options.nav.agents",
    group: "advanced",
    component: SettingsAgentsPage,
    scroll: "self",
  },
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
