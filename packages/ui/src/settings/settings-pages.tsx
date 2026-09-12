import {
  Activity,
  FileText,
  Keyboard,
  Palette,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { MessageKey } from "@amiba/i18n";

import { SettingsPersonal } from "./SettingsPersonal";
import { SettingsLogs } from "./SettingsLogs";
import { SettingsAppearance, SettingsShortcuts } from "./SettingsPreferences";
import { SettingsStatus } from "./SettingsStatus";

export interface SettingsPageProps {
  detail?: string;
  onOpenDetail: (id: string | null) => void;
  /**
   * The official `settings.general.item` seat, dispatched by the host shell
   * and handed to whichever registry page IS the General section (today:
   * Appearance). Every other page ignores it — the seat has exactly one
   * render site, as upstream does.
   */
  generalItems?: ReactNode;
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
    id: "personal",
    icon: UserRound,
    titleKey: "options.nav.personal",
    group: "general",
    component: page(SettingsPersonal),
  },
  {
    id: "appearance",
    icon: Palette,
    titleKey: "options.nav.appearance",
    group: "general",
    // NOT wrapped in `page()`: Appearance is Amiba's General section, so it
    // is the one registry page that consumes a SettingsPageProps member —
    // the `settings.general.item` seat.
    component: function AppearancePage({ generalItems }: SettingsPageProps) {
      return <SettingsAppearance generalItems={generalItems} />;
    },
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
