import { OFFICIAL_REPLACEMENTS } from "./official-replacements.js";

/** Only slots owned by the Amiba root. Child slots of live official plugins
 * (workspace directory flows and approval details) stay with those entries.
 * Declaring them here too prevents the official plugins from starting. */
export function createShellChildren(openWorkspace: (viewId: string) => void) {
  return {
    "conversation.chat.turnTail": { kind: "chain", scope: "session" },
    "sidebar.footer.action": { kind: "list", scope: "root" },
    "amiba.emptyState.visual": { kind: "list", scope: "root" },
    // The two generic session-list extension points (a "group" that
    // pulls claimed sessions into their own section, and row "more"
    // menu items). List/root scope, same shape as
    // `amiba.workspace.navigation` just below: a plugin's registered
    // component is a placeholder (never rendered) and the shell reads
    // only `options.{id,order,label}` and `inject()` — see
    // `session-list-sources.ts` and the `SessionGroupContribution` /
    // `SessionMenuContribution` inject-face types exported above.
    "amiba.sessions.list.group": { kind: "list", scope: "root" },
    "amiba.sessions.item.menu": { kind: "list", scope: "root" },
    // Message attribution. The most declarative of the three: no
    // `inject` face at all, only `options.{id,order,label}` — `id` IS
    // the plugin name core reads off a message's wire `source`, and
    // `label` is what the conversation calls it. See
    // `message-source.ts`.
    "amiba.message.source": { kind: "list", scope: "root" },
    "amiba.workspace.navigation": {
      kind: "list",
      scope: "root",
      inject: {
        openWorkspace: (viewId: string) => openWorkspace(viewId),
      },
    },
    "amiba.session.observer": { kind: "list", scope: "root" },
    "amiba.workspace.view": { kind: "list", scope: "root" },
    "main": { kind: "keyed", scope: "root" },
    "sidebar.panellist": { kind: "list", scope: "root" },
    // Official vocabulary: the right-aligned session-header utilities
    // strip, from @deepseek-ai/dsh-client-ui-conversation (replaces
    // the retired amiba.chat.header.after). SESSION scope from a
    // root-scoped parent is legal: neither ChildrenDecl nor the
    // runtime constrains a child's scope to its declarer's — the
    // scope axis only selects which standard kit the ENTRY's
    // components receive, and the renderer's StrictSessionEntry
    // renders null while no official session is current, so the home
    // view is unaffected.
    "conversation.session.header.lineage": { kind: "single", scope: "session" },
    "conversation.session.header.corner": { kind: "single", scope: "session" },
    "conversation.session.header.utilities": {
      kind: "list",
      scope: "session",
    },
    // Official per-session action slot; Amiba places it at the chat edge
    // (list, session scope, EMPTY owner — the contract is explicit
    // that an action derives sessionId and everything else from the
    // standard session kit and its own inject face). A separate seat
    // from the utilities strip above, exactly as upstream splits
    // them, so an optional utility cannot reorder session context.
    // Amiba had no such region before P3; the chat content header
    // grew one that collapses to nothing while the seat is empty.
    "conversation.session.header.actions": {
      kind: "list",
      scope: "session",
    },
    // The session-less hero model seat (vendor) and its official
    // session-scoped counterpart: the composer dispatches
    // conversation.input.model while it has a session id, the hero
    // seat otherwise. Same root-declares-session-child shape as the
    // header utilities above.
    "conversation.input.model": { kind: "single", scope: "session" },
    // Official vocabulary: the named plan-status seat in the composer
    // tool row, immediately right of the access-mode control (single,
    // session scope, owner InputControlOwnerProps { locked } — the
    // same owner share as the model seat). No occupant today: the
    // official ui-plan package is disabled, so the seat renders
    // nothing until a plugin takes it, which is exactly the contract
    // ("unoccupied, the seat renders nothing at all").
    "conversation.input.plan": { kind: "single", scope: "session" },
    "amiba.conversation.notice": { kind: "keyed", scope: "session" },
    "amiba.workbench.panel": { kind: "list", scope: "session" },
    "amiba.workbench.view": { kind: "list", scope: "root" },
    "amiba.workbench.shell": { kind: "list", scope: "root" },
    "amiba.workbench.summary": { kind: "list", scope: "root" },
    // Official vocabulary: the composer's floating overlay anchor,
    // from @deepseek-ai/dsh-client-ui-input-trigger (list, session
    // scope, NO owner share at all — every occupant reads its own
    // store and renders null while closed, so the seat costs nothing
    // when idle). This is where the official trigger menu
    // (ui-input-trigger's MenuView) and the official command popup
    // shell (ui-commands) both land.
    // DECLARATION-ANCHOR divergence, the same one already recorded for
    // tool.call.toolview: upstream declares this seat from
    // ui-conversation's composer entry (the InputBar that owns the
    // input machine), which Amiba has no equivalent of — its composer
    // is its own Lexical surface. Declaring it on this root instead is
    // legal and identical in key/kind/scope/owner; only the
    // declaration site differs. The render site is the composer card
    // (`[data-composer-card]`), which is the anchor the official
    // occupants position against and probe with `closest()`.
    ...OFFICIAL_REPLACEMENTS,
    "conversation.input.overlay": { kind: "list", scope: "session" },
    "conversation.input.dock": { kind: "list", scope: "session" },
    "conversation.composer": { kind: "chain", scope: "session" },
    "conversation.composer.dock": { kind: "list", scope: "session" },
    "conversation.chat.commandview": { kind: "keyed", scope: "session" },
    "conversation.input.left": { kind: "list", scope: "session" },
    "conversation.input.right": { kind: "list", scope: "session" },
    // Official vocabulary: the KEYED per-tool call row, from
    // @deepseek-ai/dsh-client-ui-tool (keyed, session scope, owner
    // ToolCallOwnerProps). Registration key = the wire tool name, an
    // OPEN domain, so this is the one seat whose occupants are not a
    // fixed list. DECLARATION-ANCHOR divergence, recorded once here and
    // in the SDK: upstream declares it from `conversation.chat.node`'s
    // `tool-call` entry (the Chat Node that owns the whole call tree),
    // which Amiba has no equivalent of — its conversation is its own
    // projection. Declaring it on this root instead is legal and the
    // same pattern the adopted conversation.* seats use; only the
    // declaration site differs, never the key/kind/scope/owner.
    "conversation.view": { kind: "list", scope: "session" },
    // Official vocabulary: a message's attached images, dispatched once
    // per message by the user bubble (files render as native chips
    // alongside). Amiba's default occupant is the shared
    // `MessageImagesGallery` (compact tiles, the same presentation the
    // composer uses), registered at SHADOW_PRIORITY — below the official
    // ui-attachment occupant's implicit 0 — so a plugin registering
    // strictly below the shadow priority (≤ -2) replaces the image side
    // while Amiba owns the default look. Owners carry images/loadImage/
    // align/compact straight off the official contract.
    "conversation.message.images": { kind: "single", scope: "session" },
    "tool.call.images": { kind: "single", scope: "session" },
    "conversation.chat.assistant-actions": { kind: "list", scope: "session" },
    "tool.call.toolview": { kind: "keyed", scope: "session" },
    // Amiba's keyed question seat: one entry per question id (a
    // plugin-owned question kind claims exactly its own id), `fallback`
    // is the built-in ClarifyBanner. Same keyed shape as
    // tool.call.toolview, whose key domain is the wire tool name.
    "amiba.conversation.question": { kind: "keyed", scope: "session" },
    // Official vocabulary: the settings-page ledger seat, inherited
    // from @deepseek-ai/dsh-client-ui-settings (owner: { close }).
    "settings.section": {
      kind: "list",
      scope: "root",
    },
    // The rest of the official `settings.*` family, all six of them,
    // all root-scoped, all inherited from
    // @deepseek-ai/dsh-client-ui-settings. DECLARATION-ANCHOR
    // divergence, the same one recorded for tool.call.toolview and
    // conversation.input.overlay: upstream declares these from
    // ui-settings-general's `sidebar.settings` entry (its SettingsRoot
    // owns the trigger button and the modal panel) and declares
    // settings.general.item from that package's General settings.section
    // entry. Amiba runs neither — its settings shell and its General
    // page are its own — so the seats are declared on this root.
    // Key, kind, scope and owner contract are the official ones.
    //
    // The trigger content of the sidebar's settings row; owner
    // { wide } is the sidebar column state, which the chat view knows.
    "amiba.markdown.extension": { kind: "list", scope: "root" },
    "settings.trigger": { kind: "single", scope: "root" },
    // The panel title text; the dialog is named after this node.
    "settings.header": { kind: "single", scope: "root" },
    // Shell-level actions in the page header, before Close.
    "settings.action": { kind: "list", scope: "root" },
    // The close button's visually-hidden label text.
    "settings.close": { kind: "single", scope: "root" },
    // Onboarding steps: the coordinator mounts exactly ONE at a time,
    // in registration order, and the step owns all of its own chrome.
    "settings.onboarding": { kind: "list", scope: "root" },
    // One preference row inside the General section (Amiba's
    // Appearance page). Empty owner by contract — a row draws its own
    // internals, including its label.
    "settings.general.item": { kind: "list", scope: "root" },
    // amiba.agentPreset.section is deliberately NOT declared here:
    // dsh-plugin-agent-preset declares it as a child of its own
    // settings-section entry (the amiba.tools.panel pattern).
    // Official vocabulary: the frame-wide click-through floating
    // layer, from @deepseek-ai/dsh-client-ui-layout.
    "shell.overlay": { kind: "list", scope: "root" },
  } as const;
}
