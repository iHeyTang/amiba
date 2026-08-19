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
 * DECLARATION-ANCHOR divergence, recorded once for the two seats it applies
 * to: upstream declares `tool.call.toolview` from `conversation.chat.node`'s
 * `tool-call` entry (the Chat Node that owns the whole call tree) and
 * `conversation.input.overlay` from `ui-conversation`'s composer entry (the
 * InputBar that owns the input machine). Amiba has neither entry — its
 * conversation and its composer are its own projections — so both seats are
 * declared on Amiba's root children table instead: legal, and the same
 * pattern the adopted `conversation.*` seats already use. Only the
 * DECLARATION site differs; the key, kind, scope, and owner contract are the
 * official ones.
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
 * writing `/` and `@` sources. NOTE the runtime caveat recorded below on
 * {@link ConversationInputOverlayOwnerProps}: Amiba declares and DISPATCHES
 * the overlay seat, but composes NO `inputTriggers` service today (the
 * official `ui-input-trigger` row stays disabled), so `ctx.inputTriggers` is
 * type-visible and `undefined` at runtime. A source registration therefore
 * has no pipeline to join yet; the seat itself is live for any occupant that
 * brings its own store.
 */
export type {
  CommandClaim,
  InputTriggerCandidate,
  InputTriggerPick,
  InputTriggerSource,
  PickOutcome,
  ReferenceCodec,
  ReferenceInsert,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";

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
 * RUNTIME CAVEAT (recorded honestly, Phase 4.3): the two official packages
 * that occupy this seat upstream — `ui-input-trigger`'s `MenuView` and
 * `ui-commands`' popup shell — are NOT enabled in Amiba's bundles, so the
 * seat is unoccupied by official code and Amiba's own `TriggerMenu` remains
 * the `/` and `@` menu. Both official occupants style themselves from CSS
 * modules written against the `--dsw-*` design-token layer, which ONLY
 * `@deepseek-ai/dsh-client-ui-theme` defines and which Amiba deliberately
 * keeps out of the client graph (it would fight Amiba's own palette). See
 * `docs/2026-08-15-dsh-native-architecture.md` for the full record.
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
 *   - `inspect`  — deliberately OMITTED (the member is optional). It means
 *                  "inspect this call in the TRAJECTORY view"; Amiba disables
 *                  the official `ui-trajectory` plugin and ships no
 *                  equivalent, so any callback here would lead nowhere.
 *                  Amiba's own row affordances are NOT it: the workspace pane
 *                  opens the tool's RESOURCE (a file / terminal / browser),
 *                  and the inline detail fold belongs to the very row an
 *                  occupant replaces.
 *
 * `subCalls: []` on the block is the FAITHFUL value here, not a stub:
 * upstream's builder emits `[]` for every ROOT call and fills children only
 * from `tool/code-dispatch-start` / `tool/code-dispatch`. Those events exist
 * only under Code Mode, whose `run_code` transport requires a mounted
 * `ctx.codeRuntime`; Amiba's bundles compose no code runtime and no plugin
 * requests one, so its sessions emit neither event and every call is a root.
 */
export type ToolCallToolviewOwnerProps = OwnerOf<"tool.call.toolview">;

// Official seats deliberately NOT adopted (recorded so authors know why
// these names resolve to no render site here; `tool.call.toolview` was on
// this list in Phase 3 and is now adopted above). The rule:
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
//     `session` is already available (`ctx.sessions.binding(id)`, and the
//     official ConversationSnapshot is real here — its `views`/`chat`/`nodes`
//     are the documented empty values for a composition with no registered
//     view Definitions). What blocks adoption is exactly two `InputState`
//     members: `occurrences` (each entry must address ONE U+FFFC placeholder
//     in the draft; Amiba's MentionNode projects a multi-character token, so
//     honouring it means moving that token to the clipboard/model projection
//     and keeping a side table) and `imageIds` (browser-owned unsent draft
//     ids; Amiba's attachments are host-staged, so it needs its own id space
//     in front of that). `draftRev` and a narrowed `phase` follow for free.
//     SEPARATELY, and permanently unless upstream splits the interface: a
//     faithful `sessions.provide` for `useInput`/`inputActions` is NOT
//     possible — three of five `InputActions` members (`addImages`,
//     `removeImage`, `pruneImages`) traffic in `DraftAttachmentId`s minted and
//     resolved by the `conversation` service, which Amiba must not own (it
//     bundles send/cancel/loadOlder/updateQueue/resolveImage, all of which
//     Amiba implements through its own engine).
//   - `conversation.chat.turnTail` takes `turn: TurnLocation`, an
//     engine-owned boundary carrying the raw `turn/start` / `turn/end`
//     events, a `StepLocation[]` ring, and the `data` business-value
//     reader — none of which Amiba's projection retains.
//   - `conversation.chat.assistant-actions` takes `messageId: MessageId`.
//     The wire does carry it (Amiba's own user-message branch reads
//     `message.id`), and only finalized messages reach this seat — the
//     blocker is the RENDER SITE: Amiba folds every `assistant/message` of a
//     turn into one bubble, so a turn with N model steps has N MessageIds
//     and a single action row; any one id would be arbitrary. Adoption waits
//     on a per-message bubble, not on the protocol.

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
