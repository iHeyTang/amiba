/**
 * Amiba's stable semantic slot vocabulary.
 *
 * Vocabulary policy: a seat with an official DSH equivalent uses the
 * OFFICIAL name and inherits the official contract — `shell.overlay` from
 * `@deepseek-ai/dsh-client-ui-layout`, the `settings.*` family (seven of the
 * eight declared names: `settings.section` since Phase 1, and
 * `settings.trigger` / `.header` / `.action` / `.close` / `.onboarding` /
 * `.general.item` since the settings-dialog phase) from
 * `@deepseek-ai/dsh-client-ui-settings`,
 * and the `conversation.*` family (Phase 2 adopts
 * `conversation.session.header.utilities` and `conversation.input.model`;
 * Phase 3 adds `conversation.input.plan` and
 * `conversation.session.header.actions`) from
 * `@deepseek-ai/dsh-client-ui-conversation`, `tool.call.toolview` from
 * `@deepseek-ai/dsh-client-ui-tool`, and (Phase 4.3)
 * `conversation.input.overlay` from
 * `@deepseek-ai/dsh-client-ui-input-trigger`. `amiba.*` names are
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
 *
 * DECLARATION-ANCHOR divergence, recorded once for the seats it applies to:
 * upstream declares `tool.call.toolview` from `conversation.chat.node`'s
 * `tool-call` entry (the Chat Node that owns the whole call tree),
 * `conversation.input.overlay` from `ui-conversation`'s composer entry (the
 * InputBar that owns the input machine), the six shell-level `settings.*`
 * seats from `ui-settings-general`'s `sidebar.settings` entry (the
 * `SettingsRoot` that owns the trigger button and the modal panel), and
 * `settings.general.item` from that same package's General `settings.section`
 * entry. Amiba has none of those entries — its conversation, its composer,
 * its settings shell, and its General page are its own — so every one of
 * those seats is declared on Amiba's root children table instead: legal, and
 * the same pattern the adopted `conversation.*` seats already use. Only the
 * DECLARATION site differs; the key, kind, scope, and owner contract are the
 * official ones.
 */

import type { OwnerOf, PropsRuntime, SlotMap } from "@deepseek-ai/dsh-client-ui-slots";
export type { SidebarFooterActionOwnerProps } from "@deepseek-ai/dsh-client-ui-sidebar/client";
export type { SettingsPluginItemOwnerProps } from "@deepseek-ai/dsh-client-ui-settings-plugins/client";

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
// not a hazard. The shell provides standard `useInput` and `inputActions`
// from the original editor and its resident native draft. Offscreen text
// reads/writes remain available; offscreen image additions retain browser
// registrations until native admission. Submission still requires its mounted owner. The framework members
// (`sessionId`/`useSession`/`useProjection`) ARE live — dsh-client-runtime
// itself binds those once a session is current.
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
// Type home for the official tool vocabulary: the keyed `tool.call.toolview`
// SlotMap key. Imported DIRECTLY (no mirror needed): the package's `/client`
// entry exports only `apply`/`inject` and the slot prop contracts, so unlike
// ui-layout it merges nothing into the cordis Context and cannot TS2717
// against Amiba's own service faces.
import type {} from "@deepseek-ai/dsh-client-ui-tool/client";
// Type home for the official INPUT-TRIGGER vocabulary: the
// `conversation.input.overlay` SlotMap key (the composer's floating overlay
// anchor) plus the authoring types of the trigger pipeline itself
// (`InputTriggerSource` and the `PickOutcome` family). Imported DIRECTLY like
// ui-tool: the package's `/client` entry merges `inputTriggers` into the
// cordis Context and `slash.menu` into LocaleNamespaceMap, neither of which
// Amiba declares, so there is no TS2717 to dodge and no mirror is needed.
import type {} from "@deepseek-ai/dsh-client-ui-input-trigger/client";

/**
 * Official owner contract of `settings.section`
 * (`{ close: () => void }` — the one shell affordance a section receives,
 * for flows that leave Settings altogether), re-exported so plugin authors
 * type against the SDK without reaching into the official package.
 */
export type { SettingsSectionOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";

/**
 * The rest of the official settings vocabulary, re-exported from the same
 * canonical home so a plugin author types against the SDK instead of reaching
 * into `@deepseek-ai/dsh-client-ui-settings`. Amiba declares and dispatches
 * these seats on its ui-shell root (see the declaration-anchor note in
 * the module doc); runtime-inventory owns `settings.plugins.tab`.
 *
 *   - `SettingsTriggerOwnerProps` — `{ wide: boolean }`, the sidebar column
 *     state. Amiba's sidebar knows it (its settings row lives in the same
 *     collapsible rail), so the share is supplied for real, not stubbed.
 *   - `SettingsHeaderOwnerProps` — `{ children?: never }`. The marker field
 *     is the WHOLE contract: the shell supplies nothing, and it is the owner
 *     share of `settings.header`, `settings.action` AND `settings.close`.
 *   - `SettingsOnboardingOwnerProps` — `{ stepId, complete, openSection }`,
 *     the coordinator's hand-off to the one mounted step.
 *   - `SettingsGeneralItemOwnerProps` — `{ children?: never }`. Empty by
 *     design: "nothing projects a `label` here and the owner passes no props
 *     at all — copy, current value, and the write path are all yours".
 */
export type {
  SettingsGeneralItemOwnerProps,
  SettingsHeaderOwnerProps,
  SettingsOnboardingOwnerProps,
  SettingsPluginsTabOwnerProps,
  SettingsTriggerOwnerProps,
} from "@deepseek-ai/dsh-client-ui-settings/client";

// Same interfaces, in local scope, so the derivation proof below can compare
// them against what the SlotMap merge actually produced. `export type { … }
// from` re-exports do NOT bring a name into scope.
import type {
  SettingsGeneralItemOwnerProps as OfficialGeneralItemOwner,
  SettingsHeaderOwnerProps as OfficialHeaderOwner,
  SettingsOnboardingOwnerProps as OfficialOnboardingOwner,
  SettingsTriggerOwnerProps as OfficialTriggerOwner,
} from "@deepseek-ai/dsh-client-ui-settings/client";

/** Mutual assignability of two types (`true` only when each accepts the other). */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Fails to compile the moment any member of the probe table is not `true`. */
type AssertAllTrue<T extends Record<string, true>> = T;

/**
 * Owner contracts of the six shell-level settings seats Amiba adopts,
 * RE-DERIVED from the SlotMap merge with {@link OwnerOf} rather than copied.
 * `settings.action` and `settings.close` share `SettingsHeaderOwnerProps`
 * with `settings.header` — that is the official table's own shape, not an
 * approximation on Amiba's side.
 */
export type SettingsTriggerOwner = OwnerOf<"settings.trigger">;
export type SettingsHeaderOwner = OwnerOf<"settings.header">;
export type SettingsActionOwner = OwnerOf<"settings.action">;
export type SettingsCloseOwner = OwnerOf<"settings.close">;
export type SettingsOnboardingOwner = OwnerOf<"settings.onboarding">;
export type SettingsGeneralItemOwner = OwnerOf<"settings.general.item">;

/**
 * Proof that the official settings vocabulary is actually MERGED here, not
 * merely mentioned. Two independent checks, because either one alone is weak:
 *
 *   - key presence — `OwnerOf<K>` silently resolves to `object` for a key
 *     that never reached `SlotMap`, and `object` compares mutually assignable
 *     with the empty-marker owners (`{ children?: never }`), so the
 *     assignability probe alone would pass against a missing declaration;
 *   - mutual assignability — proves the derived share is the official
 *     interface and not a widened stand-in, which key presence alone does not.
 *
 * Exported (rather than a local alias) so it stays on the declaration graph
 * and cannot be dropped as unused.
 */
export type SettingsVocabularyIsDeclared = AssertAllTrue<{
  trigger: "settings.trigger" extends keyof SlotMap ? true : false;
  header: "settings.header" extends keyof SlotMap ? true : false;
  action: "settings.action" extends keyof SlotMap ? true : false;
  close: "settings.close" extends keyof SlotMap ? true : false;
  onboarding: "settings.onboarding" extends keyof SlotMap ? true : false;
  generalItem: "settings.general.item" extends keyof SlotMap ? true : false;
  pluginsTab: "settings.plugins.tab" extends keyof SlotMap ? true : false;
}>;

/** @see SettingsVocabularyIsDeclared */
export type SettingsOwnerDerivationsHold = AssertAllTrue<{
  trigger: Mutual<SettingsTriggerOwner, OfficialTriggerOwner>;
  header: Mutual<SettingsHeaderOwner, OfficialHeaderOwner>;
  action: Mutual<SettingsActionOwner, OfficialHeaderOwner>;
  close: Mutual<SettingsCloseOwner, OfficialHeaderOwner>;
  onboarding: Mutual<SettingsOnboardingOwner, OfficialOnboardingOwner>;
  generalItem: Mutual<SettingsGeneralItemOwner, OfficialGeneralItemOwner>;
}>;

/**
 * Merge anchor for the official conversation vocabulary: import-type-only
 * inclusions are elided at declaration emit (the settings.section lesson),
 * so a named re-export must keep `@deepseek-ai/dsh-client-ui-conversation/client`
 * on the built declaration graph. The package does not export its owner
 * interfaces, so the anchor is the header entry's injected face and every
 * adopted owner contract is re-derived below via {@link OwnerOf}.
 */
export type { ComposerAttachment, ConversationSessionHeaderInjected } from "@deepseek-ai/dsh-client-ui-conversation/client";

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

/**
 * Merge anchor for the official INPUT-TRIGGER vocabulary, plus the authoring
 * types of the trigger pipeline. Named re-exports, not a bare
 * `import type {}` inclusion: those are elided at declaration emit (the
 * settings.section lesson), so only this form keeps
 * `@deepseek-ai/dsh-client-ui-input-trigger/client` on the built SDK's
 * declaration graph — and therefore keeps `conversation.input.overlay`
 * type-visible to every SDK consumer.
 *
 * `InputTriggerSource` and the `PickOutcome` family are exported for authors
 * writing `/` and `@` sources. As of Phase 4.3 (completion) the official
 * `ui-input-trigger` row is ENABLED in Amiba's web bundle and Amiba owns the
 * driver, so `ctx.inputTriggers.registerSource(...)` is LIVE: a registered
 * source's `candidates` / `onPick` / `matchSpace` / `matchEnter` / `warm` /
 * `lexicon` / `codec` are all actually consulted by the composer. The
 * one contract member Amiba deliberately does NOT drive is
 * `InputTriggerController.arbitrate` — see
 * {@link ConversationInputOverlayOwnerProps} for why (it is a menu-internal
 * keyboard helper with no source-facing callback behind it, and Amiba's own
 * menu owns the keyboard on both of its mount paths).
 */
export type {
  ArbitrateKey,
  ArbitrateOutcome,
  BeginCommandRequest,
  CandidateRequest,
  ClientSessionContext,
  CommandClaim,
  ConsumeTokenRequest,
  InputTriggerCandidate,
  InputTriggerPick,
  InputTriggerServiceContract,
  InputTriggerSource,
  InsertReferenceRequest,
  MenuState,
  PickOutcome,
  ReferenceCodec,
  ReferenceInsert,
  SubmitOutcome,
  TokenSpan,
  TriggerChar,
  TriggerGuard,
  TriggerPosition,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";

/**
 * The engine's minimal observable-snapshot face. Re-exported because every
 * store an overlay occupant reads (`InputTriggerController.menu`,
 * `PopupSelectController.state`) is one of these, and an Amiba-side mirror of
 * the shape would be a second definition of an official contract.
 */
export type { ObservableSnapshot } from "@deepseek-ai/dsh-client-runtime/client";

/**
 * Merge anchor for the official COMMAND-UI vocabulary (`ctx.commandUi`, from
 * `@deepseek-ai/dsh-client-ui-commands`). Enabled in Amiba's web bundle as of
 * Phase 4.3, so `commandUi.register({ name, ui: { kind: "popupSelect", … } })`
 * is live for plugin authors. The named re-exports keep the package on the
 * built declaration graph (the settings.section lesson) so the `commandUi`
 * Context merge reaches every SDK consumer.
 *
 * Amiba SHADOWS the official `command-popup` overlay entry with its own
 * popup — see {@link ConversationInputOverlayOwnerProps}. The registration
 * contract (`CommandContribution` / `CommandUiSpec` / `SelectOption` /
 * `SelectConfirmation`) is unchanged; only the pixels are Amiba's.
 */
export type {
  CommandContribution,
  CommandDecoration,
  CommandUiContract,
  CommandUiSpec,
  PopupState,
  SelectConfirmation,
  SelectOption,
} from "@deepseek-ai/dsh-client-ui-commands/client";

/**
 * Official owner contract of `conversation.input.overlay` — the composer's
 * floating overlay anchor (list, session scope). The owner share is EMPTY,
 * and here that is the *whole* contract rather than an omission: the seat's
 * declaration in `@deepseek-ai/dsh-client-ui-input-trigger`
 * (`lib/types/client/slots.d.ts`) carries no `owner` key at all, so
 * `OwnerOf<>` resolves to `object` and every occupant is expected to read
 * its OWN store (`MenuView` subscribes the trigger controller's menu store;
 * the `ui-commands` popup shell subscribes its own) and render `null` while
 * closed. An empty dispatch (`renderSlot("conversation.input.overlay", {})`)
 * is therefore the faithful one — anything else would be fabricated.
 *
 * Amiba's render site is the composer card in `@amiba/ui`'s `Composer`, a
 * BARE dispatch inside the `[data-composer-card]` frame: the occupants
 * position themselves (`position: absolute; bottom: calc(100% + 4px)`)
 * against that card and probe it with `closest("[data-composer-card]")` to
 * decide whether an outside pointerdown should dismiss them. An unoccupied
 * seat renders literally nothing — no wrapper, no box, no flex gap.
 *
 * OCCUPANCY (Phase 4.3 completion): `ui-input-trigger` and `ui-commands` are
 * both ENABLED, so both official packages register their overlay entries here
 * — and Amiba SHADOWS both of them through the sanctioned cell-shadowing
 * mechanism: same `id` (`slash-menu`, `command-popup`), `priority: -1`
 * against their implicit `0`. `SlotCore.entriesOfSlot` keeps the first entry
 * per cell in ascending-priority order, so exactly ONE entry renders per cell
 * and it is Amiba's.
 *
 * Why shadow rather than adopt the official pixels: both official components
 * are styled from CSS modules written against the `--dsw-*` design-token
 * layer, which ONLY `@deepseek-ai/dsh-client-ui-theme` defines — the one row
 * Amiba must keep out (its host half writes a boot palette that fights
 * Amiba's own). Worse for the popup: its risk gate is
 * `RiskConfirmation` from `@deepseek-ai/dsh-client-ui-primitives`, whose CSS
 * modules ship STUBBED (`\0dsh-css-stub`, every export `{}`) — 23 of them,
 * zero rules, zero class names. Their styling lives only in the official web
 * frontend bundle, which Amiba does not serve. A `--dsw-*` token bridge
 * therefore could not have made the popup coherent: the tokens are only half
 * the gap, and the confirmation modal has no rules to receive them.
 *
 * What Amiba does NOT shadow is the pipeline: `ctx.inputTriggers` and
 * `ctx.commandUi` are the official services, and Amiba's composer drives the
 * official `InputTriggerController` (`track` / `onSpace` / `adjudicate` /
 * `pick` / `dismiss` / `serializeReference`) and answers the four scoped
 * `slash/input-*` bail events. The single deliberate omission is
 * `arbitrate`: it is a menu-internal keyboard helper (its whole body touches
 * only the menu store and `pick`) with no source-facing callback behind it,
 * and Amiba's own `TriggerMenu` owns the keyboard identically on both of its
 * mount paths — routing arrows through `arbitrate` would give the in-session
 * menu a different highlight model than the home composer's.
 *
 * See `docs/2026-08-15-dsh-native-architecture.md` §4.1 for the full record.
 */
export type ConversationInputOverlayOwnerProps = OwnerOf<"conversation.input.overlay">;

/**
 * Merge anchor for the official TOOL vocabulary plus the authoring types of
 * the frozen call node its owner carries. `ToolCallBlock` is
 * `RunningToolCall | ToolResultNode` — the DSH client runtime's own
 * running-or-settled call node — re-exported with both arms so a registrant
 * types its `block` against the SDK instead of reaching into the official
 * packages. Named re-exports, not bare `import type {}` inclusions: those are
 * elided at declaration emit (the settings.section lesson).
 */
/** Amiba render surface hint; summary output must be inline and non-interactive. */
declare module "@deepseek-ai/dsh-client-ui-tool/client" {
  interface ToolCallOwnerProps {
    presentation?: "row" | "summary";
    revealToolCall?: (callId: string) => void;
    revealVersion?: number;
    /** Available on image-aware hosts; rc.2 tool owners predate this member. */
    loadImage?: ToolImageLoader;
  }
}
export type { ToolCallOwnerProps } from "@deepseek-ai/dsh-client-ui-tool/client";
export type {
  RunningToolCall,
  ToolCallBlock,
  ToolResultNode,
} from "@deepseek-ai/dsh-client-runtime/client";

/**
 * Official owner contract of `tool.call.toolview` — the keyed per-tool call
 * row, dispatched by the WIRE TOOL NAME. The key domain is OPEN (any wire
 * tool name, including one the registrant's own package contributed), so
 * there is no compile-time key set to pick from and a typo simply never
 * renders. Registering a name the host already presents REPLACES that row;
 * an unclaimed name keeps the host's own row, which reaches the dispatch as
 * `fallback`.
 *
 * How Amiba supplies each member (adoption is only legal when every one of
 * them is honest — an official key with a divergent owner is worse than no
 * adoption, because entries written against the upstream types compile and
 * then break at runtime):
 *
 *   - `callId`   — `ToolProgress.toolCallId`: the canonical call id, which is
 *                  `message.source.callId` on the result side.
 *   - `toolName` — derived from the BLOCK exactly as upstream's own `callName`
 *                  does (`block.call?.name ?? ""` settled, `block.name` while
 *                  running), and passed as the dispatch `entryKey`. A settled
 *                  result whose call frame fell outside the history window
 *                  therefore keys on `""` and renders the fallback, which is
 *                  upstream's behaviour too.
 *   - `block`    — built at the render site from the verbatim wire material
 *                  BOTH Amiba tool producers retain (`ToolProgress.wire`, see
 *                  `@amiba/app-runtime/protocol`); the builder lives in
 *                  `@amiba/ui` because that is where the official types and
 *                  the runtime-neutral protocol meet.
 *   - `cwd`      — the active conversation's workspace root, the same binding
 *                  the composer and the workspace pane read
 *                  (`platform.workspaces.getCurrent(sessionId)`).
 *   - `openFile` — the workspace pane's `openFile(path)`, the host file-open
 *                  path already behind Amiba's own tool rows.
 *   - `inspect`  — supplied by the shell only while a `trajectory` view is
 *                  registered. Opens that view with the actual call ID and
 *                  a one-shot acknowledgement. Session switches and view
 *                  removal invalidate old callbacks. Native resource-open
 *                  and inline detail controls retain their existing meaning.
 *
 * `block.subCalls` carries Code Mode dispatch children from live events and
 * restored history. Calls without dispatch events have an empty array.
 */
export type ToolCallToolviewOwnerProps = OwnerOf<"tool.call.toolview">;

// Official adoption requirements and recently resolved gaps. The rule:
// an official name may only be taken when its official owner contract can
// be supplied faithfully — an official key with a divergent owner is worse
// than a vendor key, because entries written against the upstream types
// would compile and then break at runtime.
//
//   - `conversation.input.dock` / `.composer.dock` / `.input.left` /
//     `.input.right` take the `InputZone` owner share
//     (`{ session: ConversationSnapshot; input: InputState }`). CORRECTED
//     RECORD: these do NOT wait on `ctx.sessions.provide` — `InputZone` is an
//     OWNER share passed at Amiba's own dispatch site, exactly like
//     `{ locked }` for `conversation.input.plan`, and the seat contract tells
//     occupants to read the owner share and never subscribe `useInput`.
//     `session` comes from ctx.sessions.binding(id). The native input bridge
//     now composes real draft/phase/reference state, browser image IDs, and
//     the actual Host inbox into the exact installed InputState type while
//     all owners are bound. References use full @label UTF-16 ranges in rc.2,
//     not the native trigger scanner's single-placeholder coordinates.
//     The four input-region owner dispatches are mounted while these real
//     sources are available. Standard useInput is also registered through
//     sessions.provide, with resident text after editor release. An unavailable session must not be masked by
//     an invented empty complete state; local pending messages are not Host
//     inbox rows. Full conversation service adoption also requires the same
//     image authority and native send/cancel semantics.
// `settings.plugins.tab` is now declared by runtime-inventory. Its real
// panels preserve the existing inventory filters. `settings.plugin.item`
// follows the installed package's keyed-by-namespace contract.
//   - `conversation.chat.turnTail` takes `turn: TurnLocation`, an
//     engine-owned boundary carrying the raw `turn/start` / `turn/end`
//     events, a `StepLocation[]` ring, and the `data` business-value
//     reader — none of which Amiba's projection retains.
//   - `conversation.chat.assistant-actions` takes the closing Assistant's
//     canonical MessageId. Installed rc.2 selects the last finalized step
//     with nonblank prose, including interrupted synthetic steps (which have
//     no message identity and therefore no actions). The merged Amiba bubble
//     is not a blocker: this projection is now carried through live events
//     and history to the action render site, without changing the bubble.

export interface SurfaceActivitySnapshot {
  sessionId: string;
  phase: "idle" | "thinking" | "responding" | "tooling" | "waiting" | "completed" | "failed" | "interrupted";
  /** Snapshot recovery is not a newly completed action. */
  restored: boolean;
  revision: number;
}
export interface SurfaceActivity {
  getSnapshot(): SurfaceActivitySnapshot;
  subscribe(listener: () => void): () => void;
}
export interface PresentationCoordinator {
  /** Higher priority wins within one product window/group; release on unmount. */
  claim(group: string, priority?: number): {
    getSnapshot(): boolean;
    subscribe(listener: () => void): () => void;
    release(): void;
  };
}

/** Coordinates are normalized to the host region, not the illustration bounds. */
export interface SurfaceInteractionSnapshot {
  pointer: { x: number; y: number } | null;
  input: { focused: boolean; active: boolean; composing: boolean };
}
export interface SurfaceInteraction {
  getSnapshot(): SurfaceInteractionSnapshot;
  subscribe(listener: () => void): () => void;
}
export interface SurfaceVisualOwner {
  activity?: SurfaceActivity;
  presentation?: PresentationCoordinator;
  /** Undefined in hosts which have not installed a region provider. */
  interaction?: SurfaceInteraction;
}

export interface EmptyStateVisualOwner {
  activity?: SurfaceActivity;
  presentation?: PresentationCoordinator;
  interaction?: SurfaceInteraction;
  scene: "home" | "conversation" | "workspace";
  /** Return this when the provider does not support the current scene. */
  defaultVisual: import("react").ReactNode;
}

export const AMIBA_ROOT_SLOTS = [
  "amiba.session.observer",
  "amiba.emptyState.visual",
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
  // The KEYED per-question seat: one entry per question id, so a plugin
  // claims exactly its own question kind and every other question keeps
  // rendering the host's built-in ClarifyBanner (the dispatch `fallback`).
  "amiba.conversation.question",
] as const;

export type AmibaRootSlot = (typeof AMIBA_ROOT_SLOTS)[number];

/**
 * Owner props of `amiba.agentPreset.section`. The TYPE lives here so every
 * contributing plugin shares one contract, but the runtime declaration is
 * NOT on the ui-shell root: dsh-plugin-agent-preset declares this slot as a
 * child of its own `settings.section` entry and dispatches it with
 * `renderSlot` (the same pattern as the catalog plugin's `amiba.tools.panel`).
 */
/** Display-only catalog contributions; callable models stay in their owning service. */
export interface AmibaProviderInventory {
  id: string;
  name: string;
  available: boolean;
  models: Array<{ id: string; name: string; description?: string; outputModalities?: string[]; supported: boolean; enabled?: boolean; pending?: boolean; onEnabledChange?: (enabled: boolean) => void }>;
}
export interface AmibaModelsExtensionOwner {
  onModelsChange?: (source: string, providers: AmibaProviderInventory[]) => void;
}

export interface AmibaAgentPresetSectionOwner {
  /** The agent preset (profile) whose detail tab strip this section renders
   *  under — scopes the section's content to that preset. */
  profileId: string;
}

export interface AmibaSessionActivity {
  sessions: readonly { id: string; unread?: boolean; readAt?: number; archived?: boolean }[];
  visibleSessionId: string;
  markUnread(id: string, activityAt?: number): Promise<void>;
  markRead(id: string, activityAt?: number): Promise<void>;
}

export interface AmibaWorkspaceViewOwner {
  sessionActivity?: AmibaSessionActivity;
  chromeHeightPx?: number;
  topBarLeftInset?: number;
  sidebarCollapsed?: boolean;
  showSidebarExpandControl?: boolean;
}

export interface AmibaWorkspaceNavigationOwner {
  sessionActivity?: AmibaSessionActivity;
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

/**
 * One selectable answer of an {@link AmibaConversationQuestionItem}.
 * Structural mirror of `@amiba/app-runtime`'s `UserQuestionOption` — that
 * type stays the canonical definition (the engine surface is host-owned);
 * this SDK repeats the shape only so the public slot contract carries no
 * app-runtime import.
 */
export interface AmibaConversationQuestionOption {
  label: string;
  description?: string;
}

/**
 * One pending question. `id` is the seat's KEY DOMAIN: a plugin registers
 * against the id its own flow emits, so it claims exactly that question and
 * nothing else.
 */
export interface AmibaConversationQuestionItem {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: AmibaConversationQuestionOption[];
  multiSelect?: boolean;
}

/** One answerable request; may carry several questions, answered as a batch. */
export interface AmibaConversationQuestionRequest {
  requestId: string;
  sessionId?: string;
  questions: AmibaConversationQuestionItem[];
}

/** One question's answer, as the host's respond wire expects it. */
export interface AmibaConversationQuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

/**
 * Owner props of `amiba.conversation.question` — the KEYED per-question seat
 * in the conversation footer, dispatched with the FIRST pending question's id
 * as `entryKey` and Amiba's own `ClarifyBanner` as the dispatch `fallback`.
 *
 * The fallback is the seat's whole visual-parity guarantee: a question id no
 * plugin registered renders EXACTLY the banner it rendered before the seat
 * existed, and a registered id replaces only that one question's screen.
 *
 * The owner share is the complete answering contract — the pending request
 * plus the host's in-flight/error state and its two terminal callbacks — so
 * an occupant needs no host wire of its own to answer or to back out.
 */
export interface AmibaConversationQuestionOwner {
  /** The pending request the host is currently showing. */
  request: AmibaConversationQuestionRequest;
  /** True while the host is delivering an answer; occupants should lock. */
  inFlight: boolean;
  /** The last delivery failure, or null. */
  error: string | null;
  /** Answer the request (one entry per answered question). */
  respond(answers: AmibaConversationQuestionAnswer[]): void;
  /** Decline the request outright. */
  cancel(): void;
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface GlobalStandardProps {
    usePanelInfo: import("@deepseek-ai/dsh-client-ui-slots").SnapshotSelectorHook<{ readonly activePanelId: string | null }>;
  }
  interface SlotMap {
    "main": { kind: "keyed"; scope: "root" };
    "sidebar.panellist": { kind: "list"; scope: "root"; owner: { size: number; active: boolean } };
    "amiba.emptyState.visual": { kind: "list"; scope: "root"; owner: EmptyStateVisualOwner };
    "amiba.navigation.before": { kind: "list"; scope: "root" };
    "amiba.navigation.after": { kind: "list"; scope: "root" };
    "amiba.workspace.navigation": {
      kind: "list";
      scope: "root";
      owner: AmibaWorkspaceNavigationOwner;
      inject: { openWorkspace(viewId: string): void };
    };
    "amiba.session.observer": { kind: "list"; scope: "root"; owner: { readStates: { sessionId: string; readAt: number }[] }; };
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
    "amiba.models.extension": { kind: "list"; scope: "root"; owner: AmibaModelsExtensionOwner };
    "amiba.agentPreset.section": {
      kind: "list";
      scope: "root";
      owner: AmibaAgentPresetSectionOwner;
    };
    /**
     * KEYED, session-scoped: registration key = the question id, an OPEN
     * domain like `tool.call.toolview`'s wire tool name. Unclaimed ids fall
     * back to the built-in ClarifyBanner.
     */
    "amiba.conversation.question": {
      kind: "keyed";
      scope: "session";
      owner: AmibaConversationQuestionOwner;
    };
    /**
     * MIRROR of the official `shell.overlay` declaration
     * (`@deepseek-ai/dsh-client-ui-layout@0.1.1-rc.2`, `/client` types
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

/** Declarative Markdown contributions. The shell collects the extension face. */
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "amiba.markdown.extension": { kind: "list"; scope: "root" };
  }
}
/** A plugin-owned tab and panel in the session workbench. */
export interface WorkbenchPanelOwner {
  /** Native workspace identity; may lag the runtime selection during navigation. */
  workbenchSessionId?: string;
  openResource(resource: import("./workbench.js").WorkbenchResource): void;
  placement: "tab" | "content";
  activePanel: string | null;
  openPanel(id: string): void;
  /** Close only this extension panel, restoring the previously selected view. */
  closePanel?(id: string): void;
  inspectToolCall(callId: string): boolean;
  renderMarkdown(text: string): ReturnType<typeof import("@amiba/markdown").ChatMarkdown>;
}

/** Canonical closing-message identity supplied to completed-turn actions. */
export type AssistantActionOwnerProps = OwnerOf<"conversation.chat.assistant-actions">;

/** Additive conversation view; inspect handoff fields are optional. */
export type { ConvViewOwnerProps } from "@deepseek-ai/dsh-client-ui-conversation/client";

export type { DirectoryFlowOwnerProps } from "@deepseek-ai/dsh-client-ui-workspace/client";

/** Exact input-state currency of the installed official input region. */
export type ConversationInputState = OwnerOf<"conversation.input.left">["input"];

export type ConversationInputZoneOwner = OwnerOf<"conversation.input.left">;

export type ConversationInputActions = PropsRuntime<"conversation.input.left">["inputActions"];

export type ComposerAttachmentsOwner = OwnerOf<"conversation.input.attachments">;

export type CommandRowOwner = OwnerOf<"conversation.chat.commandview">;

/** Additive approval contract from official c291e796, absent in the rc.2 SDK. */
export interface ApprovalDetailOwnerProps {
  callId: ToolCallToolviewOwnerProps["callId"];
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "conversation.approval.detail": {
      kind: "single";
      scope: "session";
      owner: ApprovalDetailOwnerProps;
    };
  }
}

/** Official c291e796 corner owner: state comes from the standard session kit. */
export interface ConversationHeaderCornerOwnerProps {
  children?: never;
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "conversation.session.header.corner": {
      kind: "single";
      scope: "session";
      owner: ConversationHeaderCornerOwnerProps;
    };
  }
}

/** Canonical durable image currency already present in the installed rc.2 API. */
export type ImageAttachmentRef = import("@deepseek-ai/dsh-client-ui-conversation/client").MessageImagesOwnerProps["images"][number]["attachment"];

/** Tool image contract mirrored from c291e796; rc.2 has only message images. */
export type ToolImageSource = { readonly attachment: ImageAttachmentRef } | {
  readonly preview: { readonly url: string; readonly name?: string; readonly width?: number; readonly height?: number };
};
export type ToolImageLoader = ((attachment: ImageAttachmentRef) => Promise<string>) & {
  peek?: (attachment: ImageAttachmentRef) => string | undefined;
};
export interface ToolImagesOwnerProps {
  images: readonly ToolImageSource[];
  loadImage: ToolImageLoader;
  align: "start" | "end";
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "tool.call.images": { kind: "single"; scope: "session"; owner: ToolImagesOwnerProps };
  }
}

/** Trajectory owns its image slot declaration; importing its contract retains the merge. */
export type { TrajectoryImagesOwnerProps } from "@deepseek-ai/dsh-client-ui-trajectory/client";
declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
  interface ConvViewOwnerProps {
    /** Shared session-authorized loader supplied by image-aware shells. */
    loadImage?: ToolImageLoader;
  }
}

/** Keep the installed official lineage owner, including its branded session ID. */
export type { ConversationHeaderLineageOwnerProps } from "@deepseek-ai/dsh-client-ui-conversation/client";

/** Model settings additions from the fixed official models-page contract. */
export interface ModelsFooterOwnerProps { children?: never }
export type ModelsProviderDirectoryEntry =
  Omit<Readonly<import("@deepseek-ai/dsh-api-remotes/client").ConfigurableProviderView>, "settingsPath"> &
  { readonly settingsPath: readonly string[] };
export interface ProviderCardExtrasOwnerProps {
  provider: ModelsProviderDirectoryEntry;
  configured: boolean;
  keyConfigured: boolean;
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "settings.models.footer": { kind: "list"; scope: "root"; owner: ModelsFooterOwnerProps };
    "settings.models.provider-card": { kind: "keyed"; scope: "root"; owner: ProviderCardExtrasOwnerProps };
  }
}

export type { DetailsToolOwnerProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
