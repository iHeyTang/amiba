/**
 * Amiba's stable semantic slot vocabulary.
 *
 * Vocabulary policy: a seat with an official DSH equivalent uses the
 * OFFICIAL name and inherits the official contract — `shell.overlay` from
 * `@deepseek-ai/dsh-client-ui-layout`, the `settings.*` family (most
 * importantly `settings.section`) from `@deepseek-ai/dsh-client-ui-settings`,
 * and the `conversation.*` family (Phase 2 adopts
 * `conversation.session.header.utilities` and `conversation.input.model`;
 * Phase 3 adds `conversation.input.plan` and
 * `conversation.session.header.actions`) from
 * `@deepseek-ai/dsh-client-ui-conversation`. `amiba.*` names are
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
// Amiba's runtime declares only the adopted keys on the ui-shell root;
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
 * interfaces, so the anchor is the header entry's injected face and every
 * adopted owner contract is re-derived below via {@link OwnerOf}.
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

/**
 * Official owner contract of `conversation.input.plan`
 * (`InputControlOwnerProps { locked: boolean }` — the SAME owner share as
 * the model seat: the composer's chrome disable state, honoured by refusing
 * interaction). The named plan-status seat sits in the composer tool row
 * immediately right of the access-mode control; unoccupied it renders
 * nothing at all, so an absent plan plugin costs no layout.
 */
export type ConversationInputPlanOwnerProps = OwnerOf<"conversation.input.plan">;

/**
 * Official owner contract of `conversation.session.header.actions`
 * (`ConversationHeaderActionOwnerProps` — empty, like the utilities strip:
 * an action derives `sessionId` and the rest from the framework session kit
 * and its own inject face). The title-adjacent action row, ordered by
 * ascending `order`; the right-aligned
 * `conversation.session.header.utilities` strip stays a separate seat so an
 * optional utility cannot reorder session context.
 */
export type ConversationHeaderActionsOwnerProps = OwnerOf<"conversation.session.header.actions">;

// Official seats deliberately NOT adopted (Phase 3 ruling, recorded so
// authors know why these names resolve to no render site here). The rule:
// an official name may only be taken when its official owner contract can
// be supplied faithfully — an official key with a divergent owner is worse
// than a vendor key, because entries written against the upstream types
// would compile and then break at runtime.
//
//   - `conversation.input.dock` / `.composer.dock` / `.input.left` /
//     `.input.right` take the `InputZone` owner share
//     (`{ session: ConversationSnapshot; input: InputState }`) — both are
//     ui-conversation store types produced by an input machine Amiba does
//     not run (its composer state is its own). The seats wait on the
//     `ctx.sessions.provide` work.
//   - `tool.call.toolview` (keyed by wire tool name) takes
//     `block: ToolCallBlock`, whose `content: readonly ContentBlock[]`,
//     `subCalls`, `seq`, `step` and `argsRaw` members have no source in
//     Amiba's `ToolProgress` projection (it keeps flattened result text, a
//     parsed args object, and a flat call map with no child ownership).
//   - `conversation.chat.turnTail` takes `turn: TurnLocation`, an
//     engine-owned boundary carrying the raw `turn/start` / `turn/end`
//     events, a `StepLocation[]` ring, and the `data` business-value
//     reader — none of which Amiba's projection retains.
//   - `conversation.chat.assistant-actions` takes `messageId: MessageId`
//     carried from the `assistant/message` event; Amiba's assistant bubble
//     is a TURN aggregate keyed by the turn's first seq (and a local
//     `shortId("a")` while streaming), so no faithful message identity
//     exists to pass.

export const AMIBA_ROOT_SLOTS = [
  "amiba.navigation.before",
  "amiba.navigation.after",
  "amiba.workspace.navigation",
  "amiba.workspace.view",
  // amiba.chat.header.after is RETIRED: the seat's official equivalent is
  // `conversation.session.header.utilities` (list, session scope, empty
  // owner), inherited from @deepseek-ai/dsh-client-ui-conversation above.
  "amiba.chat.content.overlay",
  // The session-less hero model seat; its session-scoped counterpart is the
  // official `conversation.input.model` (see AmibaComposerModelPickerOwner).
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
 * Owner props of `amiba.composer.modelPicker` — the SESSION-LESS hero model
 * seat (root scope, list), the vendor counterpart of the official
 * `conversation.input.model` seat. The split: while the composer has a
 * session id, it dispatches the official session-scoped seat (owner
 * `{ locked }` only — engine data reaches the occupant over the official
 * wire faces, `session.models` / `session.selectModel` via
 * `ctx.get("connection").api`); while drafting (home composer, no session)
 * it dispatches THIS seat, whose owner carries the surface-held draft
 * selection. Architecturally consistent with the official package's own
 * root-scoped `conversation.hero.*` seats.
 *
 * Mechanism-clean by design: engine-native selection shapes and host chrome
 * only, no model-plane catalog types (contributions bring their own catalog
 * source). The former `agentModels` owner pass-through is retired — engine
 * data is no longer an owner concern on either seat.
 *
 * Transport: the Composer computes these owner props and hands them to its
 * `modelPicker` render prop; the product shell backs that render prop with
 * the official renderSlot dispatch of whichever seat applies. Surfaces
 * outside a DSH plugin runtime (Quick-Ask) pass no render prop and the
 * composer renders nothing where the chip would sit.
 */
export interface AmibaComposerModelPickerOwner {
  /** Pre-session model choice held by the surface (blank composer). */
  draftSelection?: AmibaComposerModelSelection;
  /** Surface callback that stores a pre-session model choice. */
  onDraftSelectionChange?: (selection: AmibaComposerModelSelection) => void;
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
