/**
 * Amiba's stable semantic slot vocabulary.
 *
 * Vocabulary policy: a seat with an official DSH equivalent uses the
 * OFFICIAL name and inherits the official contract — `shell.overlay` from
 * `@deepseek-ai/dsh-client-ui-layout`, the `settings.*` family (most
 * importantly `settings.section`) from `@deepseek-ai/dsh-client-ui-settings`,
 * and the `conversation.*` family (Phase 2 adopts
 * `conversation.session.header.utilities` and `conversation.input.model`)
 * from `@deepseek-ai/dsh-client-ui-conversation`. `amiba.*` names are
 * reserved for vendor extensions that have no official counterpart. The
 * array below therefore lists ONLY the amiba.* vendor slots; the official
 * names reach consumers through the official packages' SlotMap merges,
 * wired up by this module (see the imports below and the mirrored
 * `shell.overlay` declaration).
 *
 * All amiba.* names are declared by the ui-shell root's children table
 * except `amiba.agentPreset.section`, whose runtime declaration lives on
 * dsh-plugin-agent-preset's settings-section entry (see
 * {@link AmibaAgentPresetSectionOwner}); the name stays here so the
 * authoring vocabulary has one home.
 */

import type { OwnerOf } from "@deepseek-ai/dsh-client-ui-slots";

// Type home for the official settings vocabulary: importing the
// dsh-client-ui-settings client entry merges `settings.section` (and the
// rest of the settings.* family) into SlotMap for every consumer of this
// SDK — plugins need no devDependency of their own. The named re-export
// below keeps that inclusion alive in the built declaration output too.
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
// Type home for the official conversation vocabulary: the same inheritance
// pattern brings the ~20 conversation.* SlotMap keys (and the
// ui-conversation SessionStandardProps members) into every SDK consumer.
// Amiba's runtime declares only the two adopted keys on the ui-shell root;
// a registration into any other type-visible conversation.* key simply
// waits in ctx.slots.inject with no render site — authoring implication,
// not a hazard. CAVEAT (recorded Phase-2 deferral): the merge also makes
// `useInput`/`inputActions` type-visible on every session-scope component,
// but amiba runs no ui-conversation runtime and registers no
// sessions.provide bundle for them, so they are `undefined` at runtime
// until a later phase provides an input machine. The framework members
// (`sessionId`/`useSession`/`useProjection`) ARE live — dsh-client-runtime
// itself binds those once a session is current.
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";

/**
 * Official owner contract of `settings.section`
 * (`{ close: () => void }` — the one shell affordance a section receives,
 * for flows that leave Settings altogether), re-exported so plugin authors
 * type against the SDK without reaching into the official package.
 */
export type { SettingsSectionOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";

/**
 * Merge anchor for the official conversation vocabulary: import-type-only
 * inclusions are elided at declaration emit (the settings.section lesson),
 * so a named re-export must keep `@deepseek-ai/dsh-client-ui-conversation/client`
 * on the built declaration graph. The package does not export its owner
 * interfaces, so the anchor is the header entry's injected face and the two
 * owner contracts are re-derived below via {@link OwnerOf}.
 */
export type { ConversationSessionHeaderInjected } from "@deepseek-ai/dsh-client-ui-conversation/client";

/**
 * Official owner contract of `conversation.session.header.utilities`
 * (empty by design: a utility derives everything from the framework session
 * kit and its own inject face — an empty owner share means self-sufficient,
 * not starved).
 */
export type ConversationHeaderUtilitiesOwnerProps = OwnerOf<"conversation.session.header.utilities">;

/**
 * Official owner contract of `conversation.input.model`
 * (`{ locked: boolean }` — the composer bar's chrome disable state; the
 * occupant owns everything else).
 */
export type ConversationInputModelOwnerProps = OwnerOf<"conversation.input.model">;

export const AMIBA_ROOT_SLOTS = [
  "amiba.navigation.before",
  "amiba.navigation.after",
  "amiba.workspace.navigation",
  "amiba.workspace.view",
  // amiba.chat.header.after is RETIRED: the seat's official equivalent is
  // `conversation.session.header.utilities` (list, session scope, empty
  // owner), inherited from @deepseek-ai/dsh-client-ui-conversation above.
  "amiba.chat.content.overlay",
  "amiba.composer.modelPicker",
  "amiba.settings.content.overlay",
  "amiba.agentPreset.section",
] as const;

export type AmibaRootSlot = (typeof AMIBA_ROOT_SLOTS)[number];

/**
 * Owner props of `amiba.agentPreset.section`. The TYPE lives here so every
 * contributing plugin shares one contract, but the runtime declaration is
 * NOT on the ui-shell root: dsh-plugin-agent-preset declares this slot as a
 * child of its own `settings.section` entry and dispatches it with
 * `renderSlot` (the same pattern as the catalog plugin's `amiba.tools.panel`).
 */
export interface AmibaAgentPresetSectionOwner {
  /** The agent preset (profile) whose detail tab strip this section renders
   *  under — scopes the section's content to that preset. */
  profileId: string;
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
    "amiba.chat.content.overlay": { kind: "list"; scope: "root" };
    "amiba.composer.modelPicker": {
      kind: "list";
      scope: "root";
      owner: AmibaComposerModelPickerOwner;
    };
    "amiba.settings.content.overlay": { kind: "list"; scope: "root" };
    "amiba.agentPreset.section": {
      kind: "list";
      scope: "root";
      owner: AmibaAgentPresetSectionOwner;
    };
    /**
     * MIRROR of the official `shell.overlay` declaration
     * (`@deepseek-ai/dsh-client-ui-layout@0.1.0-rc.6`, `/client` types
     * entry): the frame-wide click-through floating layer, identical kind
     * (list), scope (root), and empty owner. Re-declared here structurally
     * identically instead of imported because that package's `/client`
     * entry also merges `layout: ILayout` into the cordis Context, which
     * collides (TS2717) with Amiba's richer `ctx.layout` face declared by
     * dsh-plugin-ui-shell. Identical duplicate declarations merge cleanly,
     * so a program loading both declarers stays green;
     * `slot-vocabulary-guard.ts` trips this SDK's own typecheck if the
     * official shape ever drifts.
     */
    "shell.overlay": { kind: "list"; scope: "root" };
  }
}
