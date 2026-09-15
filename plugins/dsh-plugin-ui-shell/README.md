# @amiba/dsh-plugin-ui-shell

Amiba's DSH browser root plugin. Its Host half exists only for normal DSH
client-package discovery. Its Client half replaces the stock `ui-layout`
entry, provides the `layout` service required by the DSH Web Shell, owns the
single `root` registration, and declares Amiba's stable semantic child slots.

The whole product runs as ONE React tree inside the official DSH Web Shell:
the root component (`AmibaRoot`) constructs the Amiba product shell itself
and hands the official `renderSlot` dispatcher down as render props. Every
plugin contribution renders in-tree through `renderSlot` — there is no
second React root, no DOM marker scanning, and no portal side-channel.
Electron only boots the Web Shell; it never registers plugin content in
reverse.

## Stable children

Declared on the root's children table. Vocabulary policy: seats with an
official DSH equivalent carry the OFFICIAL slot name and contract;
`amiba.*` names are reserved for vendor extensions with no official
counterpart.

- `amiba.navigation.before`
- `amiba.navigation.after`
- `amiba.workspace.navigation`
- `amiba.workspace.view`
- `conversation.session.header.utilities` — official name from
  `@deepseek-ai/dsh-client-ui-conversation`: the right-aligned session-header
  utilities strip (list, SESSION scope, empty owner — utilities derive their
  state from the framework session kit). Replaces the retired
  `amiba.chat.header.after`. Session scope means the seat renders only while
  the official current session is set (the shell's sessions bridge keeps that
  in step with Amiba's own selection); the home view renders nothing here.
- `conversation.session.header.actions` — official name from the same
  package: the TITLE-ADJACENT per-session action row (list, SESSION scope,
  empty owner — the contract says an action derives everything from the
  standard session kit and its own inject face). A separate seat from the
  utilities strip above, exactly as upstream splits them, so an optional
  utility cannot reorder session context. Amiba had no such region before
  this seat; the row it added collapses (`:empty` → `display:none`) while
  the seat is unoccupied, so an absent plugin costs neither a box nor a
  flex gap. The `amiba-transcript` action opens the official Trajectory view
  and becomes “Back to chat” while it is selected. It shares this row with
  connector message sync; Trajectory no longer adds a separate tab strip.
- `amiba.chat.content.overlay`
- `amiba.composer.modelPicker` — the session-less HERO model seat (root
  scope, list), dispatched through the composer's `modelPicker` render prop
  while the composer has no session; the owner share carries the
  surface-held draft selection and picker chrome
- `conversation.input.model` — official name from
  `@deepseek-ai/dsh-client-ui-conversation`: the composer's named model seat
  (single, SESSION scope, owner `{ locked }`), dispatched through the same
  render prop once the composer has a session. The occupant reads
  `sessionId` from the framework session kit and its engine data over the
  official `session.models`/`session.selectModel` wire — engine data no
  longer rides owner props
- `conversation.input.plan` — official name from the same package: the named
  plan-status seat in the composer tool row, immediately right of the
  access-mode control (single, SESSION scope, owner
  `InputControlOwnerProps { locked }` — the same owner share as the model
  seat). Unoccupied in Amiba today (the official ui-plan package is
  disabled), which is the contract's own default: an empty seat "renders
  nothing at all — the bar paints no placeholder"
- `conversation.input.overlay` — official name from
  `@deepseek-ai/dsh-client-ui-input-trigger`: the composer's floating overlay
  anchor (list, SESSION scope, and NO owner share at all — every occupant
  reads its own store and renders `null` while closed, so `renderSlot(...,
  {})` is the faithful dispatch and anything else would be fabricated). The
  render site is the composer card in `@amiba/ui`'s `Composer`: a BARE
  dispatch as the last child of the `[data-composer-card]` frame. Both parts
  of that anchor are contract, not decoration — occupants position themselves
  `absolute; bottom: calc(100% + 4px)` against the card and probe it with
  `closest("[data-composer-card]")` to tell a pointerdown inside the composer
  apart from one outside it. OCCUPANCY: both official packages that take this
  seat upstream are ENABLED (`ui-input-trigger` for `inputTriggers`,
  `ui-commands` for `commandUi`) and this plugin SHADOWS both of their entries
  — same ids (`slash-menu`, `command-popup`), `priority: -1` against their
  implicit `0`, so `entriesOfSlot` elects exactly one entry per cell and it is
  Amiba's. What is shadowed is the pixels only (the official components are
  styled from `--dsw-*`, which only the excluded `ui-theme` defines, and the
  popup's risk gate comes from `ui-primitives`, whose CSS modules ship stubbed
  to `{}`); the pipeline is the official one, driven from this plugin's
  `input-trigger-bridge.ts` and `@amiba/ui`'s `OfficialTriggerPlugin` — see
  `docs/2026-08-15-dsh-native-architecture.md` §4.1
- `settings.section` — official name and owner contract
  (`SettingsSectionOwnerProps { close }`) inherited from
  `@deepseek-ai/dsh-client-ui-settings`; registrant options (`id`, `order`,
  `label`) drive the Settings navigation ledger, and the vendor `navIcon`
  inject-face convention still supplies the nav glyph (official plugins
  without one fall back to the generic Blocks icon). `close` now closes the
  settings DIALOG, the same path as its header button and Escape
- `settings.trigger` — official name, **single**, root scope, owner
  `SettingsTriggerOwnerProps { wide }`. The content of the sidebar's settings
  row. `wide` is the sidebar column state, which the chat view knows, so the
  owner share is a real value rather than a constant. Amiba registers NO
  entry here (a priority-0 occupant on a single slot makes the next
  registration throw); its own gear + label ride as the dispatch `fallback`
- `settings.header` — official name, **single**, root scope, EMPTY owner. The
  settings navigation heading. The dialog names itself after this node
  (`aria-labelledby`). Same fallback treatment as the trigger
- `settings.action` — official name, list, root scope, EMPTY owner.
  Shell-level actions in the page header, before Close. It COEXISTS with
  Amiba's own `[data-settings-page-actions]` portal container in the same
  trailing cluster (order: seat, portal, close button): the portal is the
  in-tree channel a page uses for its own head controls, the seat is the
  out-of-tree one a plugin registers once for every page
- `settings.close` — official name, **single**, root scope, EMPTY owner. The
  close button's visually-hidden label; the button itself is shell chrome.
  Same fallback treatment as the trigger, so the button is never nameless
- `settings.onboarding` — official name, list, root scope, owner
  `SettingsOnboardingOwnerProps { stepId, complete, openSection }`.
  COORDINATED, not additive — see "The onboarding coordinator" below
- `settings.general.item` — official name, list, root scope, EMPTY owner. One
  preference row at the bottom of the General section (Amiba's Appearance
  page), appended below the product's own rows. This seat has a REAL occupant:
  `@deepseek-ai/dsh-client-locale` registers its own `LanguageRow` here
  (`id: "language"`, `order: 0`). UI Shell registers the same cell at
  `priority: -1`, so the product's ONLY 语言 control uses `@amiba/ui`'s
  standard Select while the official locale service remains its state owner —
  see "The language authority" below
- `amiba.settings.content.overlay`
- `shell.overlay` — official name from `@deepseek-ai/dsh-client-ui-layout`:
  the frame-wide click-through floating layer
- `tool.call.toolview` — official name from
  `@deepseek-ai/dsh-client-ui-tool`: the per-tool call row, KEYED by the wire
  tool name (keyed, SESSION scope, owner `ToolCallOwnerProps`). One of the two
  seats here whose occupants are not a fixed list (the other is
  `amiba.conversation.question`, below) — the key domain is open, so a plugin
  registers `key: "<wire tool name>"` and owns how that tool's calls render
  inside a turn. Every unclaimed name renders Amiba's own
  `ToolSpec`-driven tool chip, which the shell passes as the dispatch
  `fallback`, so with no plugin registered the conversation is byte-identical
  to before the seat existed. Owner supply: `callId` / `toolName` / `block`
  come from the row (the `block` is rebuilt from the verbatim wire material
  both Amiba tool producers retain), `cwd` from the conversation's workspace
  binding, `openFile` from the workspace pane. `inspect` opens the official trajectory view focused on the call when
  that view is available
- `amiba.conversation.question` — Amiba's own name: the per-question screen in
  the conversation footer, KEYED by the question id (keyed, SESSION scope,
  owner `AmibaConversationQuestionOwner`). The second seat here with an open
  key domain — a plugin registers `key: "<question id>"` and owns how that one
  question is asked and answered; the dispatch `entryKey` is the FIRST pending
  question's id. Every unclaimed id renders Amiba's own `ClarifyBanner`, which
  the shell passes as the dispatch `fallback`, so with no plugin registered the
  footer is byte-identical to before the seat existed. Owner supply: the
  pending `request`, the host's `inFlight`/`error` state, and its
  `respond`/`cancel` callbacks — the complete answering contract, so an
  occupant needs no host wire of its own. First occupant:
  `@amiba/dsh-plugin-connector-core` claims `amiba.connect-wizard` and runs the
  connect wizard there

DECLARATION-ANCHOR divergence, recorded once for the seats that have one:
upstream declares `tool.call.toolview` from `conversation.chat.node`'s
`tool-call` entry (the Chat Node that owns the whole call tree), the six
shell-level `settings.*` seats from `ui-settings-general`'s `sidebar.settings`
entry (the `SettingsRoot` that owns the trigger button and the modal panel),
and `settings.general.item` from that package's General `settings.section`
entry. Amiba has none of those entries (its conversation, its settings shell
and its General page are its own), so the seats are declared on this root
instead. Legal, and the same pattern the adopted `conversation.*` seats
already use; only the declaration SITE differs — the key, kind, scope, and
owner contract are the official ones.

## Settings is a dialog, not a view

`product-shell.tsx` no longer swaps the main area for a settings route. The
chat surface stays mounted and `@amiba/ui`'s `SettingsDialog` layers over it
with the official shell's structure: mask + `role="dialog" aria-modal="true"`
panel, `aria-labelledby` pointing at the navigation heading (the
`settings.header` seat), Escape and mask-click close paths, and
`aria-haspopup="dialog"` + a live `aria-expanded` on the sidebar trigger.
Amiba's own `SettingsView` / `SettingsPageScaffold` / `PaneHeaderBar` /
page-registry framework renders inside it unchanged — this is a container
change, not a redesign.

This is also what makes `settings.close` honest: before it, Amiba had only a
back affordance, and mapping that to the official close label would have been
a lie.

**Hash deep links survive.** Section addressing still has exactly one source,
the URL hash, and `useSettingsShell` still writes it before opening: with the
dialog closed `SettingsView` is unmounted and reads the fresh hash as it
mounts, and with it already open the synchronous `hashchange` moves it
(`replaceState` fires no event of its own). Every entry path funnels through
the same `open-settings` layout action — the sidebar's section rows,
`ctx.layout.openSettings(id)` from any plugin, and the onboarding owner's
`openSection(id)`.

Focus is the one deliberate departure from upstream: the panel takes focus on
open and returns it to the element that opened it on close, where upstream
focuses its close button on mount and restores nothing. Amiba's settings pages
remount per navigation, so auto-focusing a per-page control would steal focus
on every nav click.

## The onboarding coordinator

`settings.onboarding` is coordinated, not additive: the shell mounts exactly
ONE step at a time. The rules are upstream's `SettingsRoot`, reproduced one by
one, split across two files by what they depend on:

| rule | where |
| --- | --- |
| 1. active = sessions `phase === "ready"` AND (no current OR current is `blank`) | `settings-onboarding.ts`, a pure predicate over the OFFICIAL `SessionListState` |
| 2. active step = the first REGISTERED step not yet completed | `@amiba/ui`'s `useOnboardingCoordinator` |
| 3. render exactly that one, via `{ only: stepId }` | `product-shell.tsx` |
| 4. `complete()` marks it done and hands off to the next | `useOnboardingCoordinator` |
| 5. `openSection(id)` opens the dialog on that section | `ctx.layout.openSettings(id)`, the same affordance the nav uses |
| 6. completion is NOT persisted — it resets when active goes false | `useOnboardingCoordinator` |

Rule 1 is read through the framework's own `useSessions` standard hook
(`GlobalStandardProps`, present on every slot component's props), not
re-derived from Amiba's session store. That is what makes the seat honest
rather than approximate: the R1 sessions bridge already keeps the official
`current` in lock-step with Amiba's `activeId`, so Amiba's home view IS
`current === undefined`, and `blank` is the host's own empty-log bit, which
flips to false on the first accepted prompt.

Rule 6 is copied deliberately. A user who completes step A, sends a message,
and returns to a blank session sees step A again. Upstream owns the flow's
semantics; diverging here would make third-party steps written against the
official shell behave differently under Amiba.

Amiba ships no onboarding steps of its own — the coordinator and the seat are
the deliverable.

## The language authority

`locale-bridge.ts` + `language-seat.tsx`. The OFFICIAL locale service decides
the language, for the official/plugin copy AND for Amiba's own. UI Shell owns
only the visual shadow of the official `language` cell; it reads and writes
that same service through an Amiba Select. Amiba used to own a
second preference (`settings.ui.language`, `auto | en | zh-CN`) with its own
row in Appearance; once `settings.general.item` was declared, upstream's
`LanguageRow` landed on the same page and the product showed two 语言 controls
that did not agree. Amiba's is retired. The explicit "auto" option went with
it — official has no equivalent, and its never-chosen state already follows the
browser.

Language authority:

- **Authority.** `ctx.inject(["locale"], …)` hands `@amiba/i18n` the official `LocaleRuntime` through
  `installOfficialLocale` — the same `getSnapshot`/`subscribe` LocaleFace pair
  the framework's own `t` seat consumes via `ctx.slots.installLocale`. A switch
  in the shadow row re-renders Amiba's copy in the same tick, no reload. The
  guard is `ctx.inject` rather than the plugin's `inject` list on purpose: the
  product shell must mount even where `locale` is absent, and without it Amiba
  simply keeps the browser-derived fallback (what Quick-Ask does).

**Id mapping.** Official ships `zh` and `en`; Amiba's catalogs are `zh-CN` and
`en`, and `setLocale` THROWS on an unregistered id. `toOfficialLocaleId` in
`@amiba/i18n` returns the official union, so `zh-CN` leaking into `setLocale`
is a compile error rather than a runtime throw; `fromOfficialLocaleId` is total
(primary subtag, unknown ids land on English). `@amiba/i18n` cannot depend on
`@deepseek-ai/*` — Quick-Ask and the browser surfaces consume it without a DSH
graph — so the hand-written union is tied to upstream's `LocaleId` by the
`OfficialLocaleIdMatchesUpstream` probe in this package.

**Cross-realm.** Every plugin bundle carries its own copy of `@amiba/i18n`'s
module state, so a module-level source would reach none of them. It lives on
`Symbol.for("@amiba/i18n/official-locale")` instead — one source, one
subscription, fanned out to every copy in the realm. The realm holding it still
PUBLISHES `document.documentElement.lang`, but as a projection rather than as
the transport: the attribute is what this package's `usePluginT`, the
non-React slot-label readers, and the `settings.section` ledger's cache key
observe, plus `<html lang>` being correct in its own right.

## The dictionary

`messages.ts`. Separate from the bridge above on purpose: that one decides
WHICH LANGUAGE, this one decides WHERE THE STRINGS COME FROM.

`@amiba/i18n` ships no catalogs. The dictionaries live with their owners —
`@amiba/ui/locales` (the component copy and the shared vocabulary), this
package's own `./locales` (the app-shell copy), and `apps/desktop`'s window
copy for the two Electron windows that boot no plugin graph. `messages.ts`
merges the first two and registers the result as ONE namespace, `amiba`, with
`ctx.locale.register` — upstream binds a namespace to a single owner, so one
namespace registered in one place is what lets `useT()` keep taking no
namespace and every call site stay byte-identical.

Two installs, in order:

1. `installAmibaMessageCatalog()`, unconditionally in `apply`. `ctx.locale` is
   optional here (see the bridge's `ctx.inject` note), and without this a
   composition missing `dsh-client-locale` would render every Amiba string as
   its raw dotted key. It is the runtime-less path Quick-Ask takes, applied to
   a realm where the service happens to be absent.
2. `registerAmibaMessages(scope.locale)`, on its own `ctx.inject(["locale"])`
   fiber — registering the dictionary needs the locale service and nothing
   else, so it must not wait on `settingsScope`. It supersedes step 1, and its
   disposer restores it.

The payoff is measured on built output, not argued: this bundle is the only
`plugins/<id>/lib/client.js` that carries Amiba's copy. The others dropped
~82 KB each (`dsh-plugin-runtime-inventory`: 273,884 -> 192,280 bytes).
`scripts/verify-dsh-architecture.mjs` asserts both halves — the sentinel is
present here and absent everywhere else.

## The input-trigger driver

`input-trigger-bridge.ts` is what makes `ctx.inputTriggers.registerSource(...)`
honest here. The service face is `registerSource` / `sessionOf` alone, so a
registered source is consulted only if the HOST drives the per-session
controller and answers the four scoped `@mode bail` input events. This plugin
supplies both halves and `@amiba/ui`'s composer supplies the editor side:

| official member | driven from |
| --- | --- |
| `track(draft, caret, guard, draftRev)` | `OfficialTriggerPlugin`, inside `registerUpdateListener` (read-only) |
| `onSpace()` | `OfficialTriggerPlugin`, a NATIVE keydown listener on the editor root |
| `adjudicate(line, signal)` | `Composer.handleSend`, the Enter path |
| `pick` / `dismiss` | `OfficialTriggerMenu`, from the shadowed seat |
| `serializeReference` | submit-time chip expansion |
| the four `slash/input-*` bail events | `bindEditor`, delegating to the Lexical verbs |
| `CommandClaim.submit(args, actx)` | `submitClaim`, with the REAL session-scope ctx |

`onSpace` rides a native listener rather than a Lexical command on purpose: a
command handler runs inside `editor.update`, and Lexical DEFERS a nested
update — the verbs could not report applied-truth from there.

Each bail listener returns `true` only when its verb reports an OBSERVED
mutation (a re-scan of the draft, or a checked post-condition), and the
listeners exist exactly while an editor is bound, so "no composer for this
session" is reported by the absence of a listener rather than by a guess.

`arbitrate` is deliberately NOT driven: it is a menu-internal keyboard helper
with no source-facing callback behind it, and Amiba's `TriggerMenu` owns the
keyboard identically on both of its mount paths.

`amiba.agentPreset.section` remains part of the public vocabulary
(`@amiba/extension-sdk`) but its runtime declaration lives on
`dsh-plugin-agent-preset`'s settings-section entry, which dispatches it with
`renderSlot` — the same feature-owned child-slot pattern as
`amiba.tools.panel`.

The former `amiba.settings.navigation.before/assistant/after` trio is
retired: the section-ledger navigation is rendered directly by the product
shell (it owns both the component and the ledger source), and the
before/after seats had no registrants.

Every contributing client plugin declares `@amiba/dsh-plugin-ui-shell` in its
`dsh.client.inject` list, imports the slot contract types, and registers through
the official Slot service:

```ts
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@amiba/extension-sdk";

export const inject = ["slots"];

function HeaderAction() {
  return <button type="button">My action</button>;
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject("conversation.session.header.utilities", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.utilities",
        id: "my-feature.action",
        order: 100,
      },
      HeaderAction,
    ),
  );
}
```

The SDK loads Amiba's `SlotMap` declaration merge. The runtime dependency is
expressed through DSH's client graph, not through an Electron bridge. Feature
plugins may also declare their own nested `children`; `amiba.tools.panel`
(catalog) and `amiba.agentPreset.section` (agent-preset) are the current
feature-owned child slots.
