/**
 * Amiba's stable semantic slot vocabulary. All names are declared by the
 * ui-shell root's children table except `amiba.agentPreset.section`, whose
 * runtime declaration lives on dsh-plugin-agent-preset's settings-section
 * entry (see {@link AmibaAgentPresetSectionOwner}); the name stays here so
 * the authoring vocabulary has one home.
 */
export const AMIBA_ROOT_SLOTS = [
  "amiba.navigation.before",
  "amiba.navigation.after",
  "amiba.workspace.navigation",
  "amiba.workspace.view",
  "amiba.chat.header.after",
  "amiba.chat.content.overlay",
  "amiba.composer.modelPicker",
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
}

/**
 * Owner props of `amiba.agentPreset.section`. The TYPE lives here so every
 * contributing plugin shares one contract, but the runtime declaration is
 * NOT on the ui-shell root: dsh-plugin-agent-preset declares this slot as a
 * child of its own `amiba.settings.section` entry and dispatches it with
 * `renderSlot` (the same pattern as the catalog plugin's `amiba.tools.panel`).
 */
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

/**
 * Engine-native model selection. Structural mirror of
 * `@amiba/app-runtime/platform`'s `AgentModelSelection` — that type stays the
 * canonical definition (the engine surface is host-owned); this SDK repeats
 * the shape only so the public slot contract carries no app-runtime import.
 */
export interface AmibaComposerModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/**
 * Host-wired pass-through of the engine-native agent-models surface
 * (`getPlatform().agentModels` on the host side). The composer hands this to
 * the slot contribution so the plugin never touches the platform contract
 * itself. `directory` resolves `null` while the session has no materialized
 * engine directory (blank/draft composers).
 *
 * Owner-prop contract: owner props are passed at every renderSlot dispatch,
 * so contributions always see the current render's values — the old
 * marker-scan snapshot rule (identity-stable functions only) no longer
 * binds. Function props may close over current state; hosts still memoize
 * long-lived surfaces like this one so effect dependencies stay quiet.
 */
export interface AmibaComposerAgentModels {
  directory(sessionId: string): Promise<{
    current: AmibaComposerModelSelection;
    routable: boolean;
  } | null>;
  select(
    sessionId: string,
    selection: AmibaComposerModelSelection,
  ): Promise<{ selected: AmibaComposerModelSelection }>;
}

/**
 * Owner props of `amiba.composer.modelPicker` — the chat composer's model
 * picker hole. Mechanism-clean by design: engine-native selection shapes and
 * host chrome only, no model-plane catalog types (contributions bring their
 * own catalog source).
 *
 * Transport: the Composer computes these owner props and hands them to its
 * `modelPicker` render prop; the product shell backs that render prop with
 * the official `renderSlot("amiba.composer.modelPicker", owner)` dispatch.
 * Surfaces outside a DSH plugin runtime (Quick-Ask) pass no render prop and
 * the composer renders nothing where the chip would sit.
 */
export interface AmibaComposerModelPickerOwner {
  /** Materialized DSH session behind the composer, or null while drafting. */
  sessionId: string | null;
  /** Pre-session model choice held by the surface (blank composer). */
  draftSelection?: AmibaComposerModelSelection;
  /** Surface callback that stores a pre-session model choice. */
  onDraftSelectionChange?: (selection: AmibaComposerModelSelection) => void;
  /** Engine-native surface, host-owned and passed through (never imported). */
  agentModels: AmibaComposerAgentModels;
  disabled?: boolean;
  /** Height treatment for the picker dialog in constrained hosts. */
  dialogSize?: "default" | "tall";
  /** Modal overlay treatment (mirrors `@amiba/ui`'s DialogOverlayVariant). */
  overlayVariant?: "dimmed" | "transparent";
  /** Bumped when a persistent host is re-activated; reloads picker state. */
  refreshKey?: number;
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
    "amiba.composer.modelPicker": {
      kind: "list";
      scope: "root";
      owner: AmibaComposerModelPickerOwner;
    };
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
