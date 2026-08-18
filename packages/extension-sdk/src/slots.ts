export const AMIBA_ROOT_SLOTS = [
  "amiba.navigation.before",
  "amiba.navigation.after",
  "amiba.workspace.navigation",
  "amiba.workspace.view",
  "amiba.chat.header.after",
  "amiba.chat.content.overlay",
  "amiba.settings.navigation.before",
  "amiba.settings.navigation.assistant",
  "amiba.settings.navigation.after",
  "amiba.settings.section",
  "amiba.settings.content.overlay",
  "amiba.agentPreset.section",
  "amiba.shell.overlay",
] as const;

export type AmibaRootSlot = (typeof AMIBA_ROOT_SLOTS)[number];

export interface AmibaSettingsSectionOwner {
  chromeHeightPx?: number;
  /** Getter for the settings head's right-side actions container. Section
   *  content renders in its own React root; portal into this node via
   *  SettingsPageActions' `host` prop. */
  headerActionsHost?: () => HTMLElement | null;
}

export interface AmibaAgentPresetSectionOwner {
  /** The agent preset (profile) whose detail tab strip this section renders
   *  under — scopes the section's content to that preset. */
  profileId: string;
}

export interface AmibaSettingsNavigationOwner {
  /** The Settings Shell owns selection; plugin navigation only renders it. */
  activeSection?: string;
}

export interface AmibaWorkspaceViewOwner {
  chromeHeightPx?: number;
  topBarLeftInset?: number;
  sidebarCollapsed?: boolean;
  showSidebarExpandControl?: boolean;
}

export interface AmibaWorkspaceNavigationOwner {
  activeView?: string;
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "amiba.navigation.before": { kind: "list"; scope: "root" };
    "amiba.navigation.after": { kind: "list"; scope: "root" };
    "amiba.workspace.navigation": {
      kind: "list";
      scope: "root";
      owner: AmibaWorkspaceNavigationOwner;
      inject: { openWorkspace(viewId: string): void };
    };
    "amiba.workspace.view": {
      kind: "list";
      scope: "root";
      owner: AmibaWorkspaceViewOwner;
    };
    "amiba.chat.header.after": { kind: "list"; scope: "root" };
    "amiba.chat.content.overlay": { kind: "list"; scope: "root" };
    "amiba.settings.navigation.before": { kind: "list"; scope: "root" };
    "amiba.settings.navigation.assistant": {
      kind: "single";
      scope: "root";
      owner: AmibaSettingsNavigationOwner;
    };
    "amiba.settings.navigation.after": { kind: "list"; scope: "root" };
    "amiba.settings.section": {
      kind: "list";
      scope: "root";
      owner: AmibaSettingsSectionOwner;
    };
    "amiba.settings.content.overlay": { kind: "list"; scope: "root" };
    "amiba.agentPreset.section": {
      kind: "list";
      scope: "root";
      owner: AmibaAgentPresetSectionOwner;
    };
    "amiba.shell.overlay": { kind: "list"; scope: "root" };
  }
}
