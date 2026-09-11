# @amiba/extension-sdk

Public authoring contracts for DSH plugins targeting the Amiba Web Shell.

The SDK exports typed Host/Client helpers, stable Amiba root child-slot names,
owner/injection types, and the `SlotMap` declaration merge used by DSH's
official slot service.

Vocabulary policy: a seat with an official DSH equivalent uses the OFFICIAL
slot name and inherits the official contract — the `settings.*` family comes
from `@deepseek-ai/dsh-client-ui-settings`, `shell.overlay` from
`@deepseek-ai/dsh-client-ui-layout`, the `conversation.*` family from
`@deepseek-ai/dsh-client-ui-conversation`, `tool.call.toolview` from
`@deepseek-ai/dsh-client-ui-tool`, and `conversation.input.overlay` from
`@deepseek-ai/dsh-client-ui-input-trigger`. Twelve seats are adopted from those
four packages, with their owner contracts re-derived here.

### The `settings.*` family

Seven of the eight official settings seats are declared here. Every one of
them is root-scoped, and the owner column is the whole contract — several are
the empty marker interface, which means "self-sufficient", not "starved".

| seat | kind | owner | render site in Amiba |
| --- | --- | --- | --- |
| `settings.trigger` | single | `SettingsTriggerOwnerProps` (`{ wide }`) | content of the sidebar's settings row; `wide` is false while the rail is collapsed |
| `settings.header` | single | `SettingsHeaderOwnerProps` (empty) | the settings navigation heading — the node the dialog is named after |
| `settings.action` | list | `SettingsHeaderOwnerProps` (empty) | the page header's trailing cluster, before Close |
| `settings.close` | single | `SettingsHeaderOwnerProps` (empty) | the close button's visually-hidden label |
| `settings.section` | list | `SettingsSectionOwnerProps` (`{ close }`) | one settings page; `id` / `order` / `label` drive the navigation ledger |
| `settings.onboarding` | list | `SettingsOnboardingOwnerProps` (`{ stepId, complete, openSection }`) | one step at a time, layered over the whole shell |
| `settings.general.item` | list | `SettingsGeneralItemOwnerProps` (empty) | one preference row at the bottom of the General (Appearance) page |

Three of these behave differently from the rest and are worth knowing before
you register:

- **The three `single` seats (`trigger`, `header`, `close`) are UNOCCUPIED by
  default, on purpose.** Amiba's own content rides as the dispatch `fallback`
  rather than as a registration, because a priority-0 occupant on a single
  slot makes the NEXT registration throw — registering Amiba's own would lock
  every plugin out of the seat. So a plain `ctx.slots.register({ name:
  "settings.trigger" }, …)` wins the cell and replaces Amiba's row content.
- **`settings.onboarding` is coordinated, not additive.** The shell mounts
  exactly one step — the first registered entry that has not completed — and
  only while the onboarding fact is active (the session list is ready AND
  either no session is current or the current one is blank). Your step owns
  its own visible chrome and renders `null` while it is still deciding; the
  shell paints nothing around it. `complete()` hands off to the next step,
  `openSection(id)` opens the settings dialog directly on a registered
  section. **Completion is not persisted** — leaving the active condition
  resets the whole set, which is upstream's own behaviour, copied verbatim.
- **`settings.general.item` gets no props at all.** The section only stacks
  rows, so a row draws its own internals including its label, and reads and
  writes its value through its own inject face.

`settings.plugins.tab` is the one member of the family Amiba does NOT declare.
Its type is exported (`SettingsPluginsTabOwnerProps`) so the name stays
addressable, but the contract is a structure rather than a props shape — "the
section owner renders localized entry labels as tabs and mounts each
contribution inside its corresponding tab panel" — and Amiba's Plugins page is
a single inventory list behind an `all / amiba / dsh / failed` filter, not a
tab strip with panels. Registering there today would leave you with no render
site; see the not-adopted record in `src/slots.ts`.

### The `conversation.*` and `tool.*` seats

| seat | kind / scope | owner | render site |
| --- | --- | --- | --- |
| `conversation.session.header.utilities` | list / session | `ConversationHeaderUtilitiesOwnerProps` (empty) | right-aligned strip in the chat header (replaced the retired `amiba.chat.header.after`) |
| `conversation.session.header.actions` | list / session | `ConversationHeaderActionsOwnerProps` (empty) | title-adjacent action row in the chat header |
| `conversation.input.model` | single / session | `ConversationInputModelOwnerProps` (`{ locked }`) | composer tool row, left of the send button |
| `conversation.input.plan` | single / session | `ConversationInputPlanOwnerProps` (`{ locked }`) | composer tool row, immediately right of the access-mode control |
| `conversation.input.overlay` | list / session | `ConversationInputOverlayOwnerProps` (empty) | floating layer anchored to the composer card (`[data-composer-card]`) |
| `tool.call.toolview` | **keyed** / session | `ToolCallToolviewOwnerProps` (= the official `ToolCallOwnerProps`) | one tool call row inside a turn, dispatched by the wire tool name |

`conversation.input.overlay` is where a `/`-command popup or an `@`-reference
menu goes. Its owner share is empty *by declaration* — the official SlotMap
entry has no `owner` key — so an occupant reads its own store and renders
`null` while closed; the host dispatches `{}` and nothing else would be
honest. Two facts about the anchor are contract rather than styling: the seat
renders inside the element carrying `data-composer-card` (which also contains
the editor), and occupants position themselves against that box, typically
`position: absolute; bottom: calc(100% + 4px); left: 0`, and call
`closest("[data-composer-card]")` on themselves to tell a pointerdown inside
the composer apart from one outside it.

```tsx
ctx.slots.inject("conversation.input.overlay", () =>
  ctx.slots.register(
    { name: "conversation.input.overlay", id: "my-popup", order: 2 },
    // props: the (empty) owner share + the session standard kit
    ({ sessionId }) => <MyPopup sessionId={sessionId} />,
  ),
)
```

### `inputTriggers` and `commandUi` are LIVE

Both official rows are enabled and Amiba owns the driver, so the two service
faces do what their contracts say:

```ts
// A `@` reference source. Every callback below is actually consulted.
ctx.effect(() =>
  ctx.inputTriggers.registerSource({
    trigger: "@",
    name: "my-docs",          // menu group heading; unique per trigger
    order: 10,
    candidates: async (session, req) => search(req.query, req.signal),
    onPick: (pick) => ({
      insert: {
        source: "my-docs",
        ref: pick.candidate.name,
        label: pick.candidate.name,
        clipboardText: `@${pick.candidate.name}`,
      },
    }),
    // REQUIRED for `{ insert }` sources: this is what reaches the model.
    codec: {
      clipboardText: (ref) => `@${ref}`,
      serialize: async (ref, signal) => `<doc>${await resolve(ref, signal)}</doc>`,
    },
  }),
)

// A `/` command with a popup. The popup shell, the option filter, and the
// shared confirmation gate are all provided for you.
ctx.effect(() =>
  ctx.commandUi.register({
    name: "pick-model",
    description: "Choose an inference model",
    available: () => true,
    ui: {
      kind: "popupSelect",
      options: async (session, signal) => listModels(session, signal),
      onSelect: async (option, session) => selectModel(option.id, session),
    },
  }),
)
```

What that buys, concretely: your group appears in Amiba's trigger menu; a pick
inserts a real chip; `codec.serialize` output — not the clipboard text — is
what the model receives on submit; a serialization failure BLOCKS the send with
a visible reason rather than downgrading silently; `matchSpace` / `matchEnter`
are polled on space and Enter; `warm` fires at session-scope birth.

Two honest caveats:

- **`arbitrate` is not driven.** It is a menu-internal keyboard helper with no
  source-facing callback behind it; Amiba's own menu owns the keyboard on both
  of its mount paths. No `InputTriggerSource` member is reachable only through
  it.
- **The overlay COMPONENTS are shadowed.** Amiba registers its own
  `slash-menu` and `command-popup` entries at `priority: -1`, so the official
  `MenuView` and `PopupSelectView` never render — they are styled from
  `--dsw-*`, which only the excluded `ui-theme` defines, and the popup's risk
  gate comes from `ui-primitives`, whose CSS modules ship stubbed to `{}`.
  Registration contracts are unaffected; only the pixels are Amiba's. To take
  the seat yourself, register a DIFFERENT `id` and bring your own store.
  Registering `slash-menu` or `command-popup` at `priority: -1` would collide
  with Amiba's entry and throw at registration.

A source registered with `('/', "command")` will THROW: `ui-commands` owns that
identity. Amiba's own `/` sources are `skill` and (session-less surfaces only)
`command`; its `@` source is `session`.

Both header seats and both composer control seats render NOTHING while
unoccupied — no placeholder, no reserved space, no flex gap; so does an
unoccupied `conversation.input.overlay`. `tool.call.toolview` is
different in kind: it is KEYED and never empty. Register `key: "<wire tool
name>"` to own how that one tool's calls render; every name no plugin claimed
keeps Amiba's own tool chip, which the host passes as the dispatch
`fallback`. The key domain is open (any wire tool name, including one your own
package registered), so there is no compile-time key set and a typo simply
never renders.

```tsx
ctx.slots.inject("tool.call.toolview", () =>
  ctx.slots.register(
    { name: "tool.call.toolview", key: "bash" },
    // props: ToolCallOwnerProps + the session standard kit
    ({ block, cwd, openFile, presentation }) => <MyTerminalCard block={block} cwd={cwd} onOpen={openFile} presentation={presentation} />,
  ),
)
```

Amiba supplies `presentation: "summary"` when the same keyed tool renderer is
used inside the live execution disclosure, and `"row"` for its detail list.
Summary renderers must return inline, non-interactive content: action + target,
without buttons, evidence, side effects, or task controls. `SemanticToolRow`
forwards this hint automatically; custom rows built with `ToolRowFrame` pass
`presentation={props.presentation}`. Fully custom renderers must handle it
explicitly. The summary and row must derive their action/target from the same
plugin-owned definition; do not register a second tool-name map in core.

How Amiba supplies that owner share: `callId` from the canonical call id,
`toolName` derived from the block exactly as upstream's own `callName` does
(and reused as the dispatch `entryKey`), `block` rebuilt from the verbatim
`tool/call` / `tool/result` material both Amiba tool producers retain, `cwd`
from the conversation's workspace binding, `openFile` from the workspace
pane's file-open path. `inspect` is deliberately OMITTED (it is optional): it
means "inspect this call in the trajectory view", and Amiba disables the
official `ui-trajectory` plugin and ships no equivalent. `block.subCalls` is
`[]`, which is upstream's own value for every ROOT call — children come only
from Code Mode's dispatch events, and Amiba's bundles mount no code runtime.
Its runtime declaration sits on Amiba's root children table rather than
upstream's `conversation.chat.node` `tool-call` entry, which Amiba has no
equivalent of; only the declaration site differs.

`amiba.*` names are reserved for
vendor extensions with no official counterpart; only those appear in
`AMIBA_ROOT_SLOTS`. Importing this SDK makes the official names visible in
`SlotMap` — plugins need no extra dependency. Note the inheritance makes ALL
conversation.* keys type-visible while Amiba runtime-declares only the
adopted seats: registering into an undeclared key waits in `ctx.slots.inject`
with no render site. Four seats are NOT adopted, for three different
reasons. Structure Amiba's page does not have: `settings.plugins.tab` (its
contract is a tab strip with per-entry panels; Amiba's Plugins page is one
inventory list behind a filter — see above). Contract Amiba genuinely cannot
supply today:
`conversation.chat.turnTail` (`TurnLocation` is an engine-owned boundary with
a business-value reader over machinery Amiba does not run). Render site, not
contract: `conversation.chat.assistant-actions`, whose `MessageId` is on the
wire but whose render site folds a whole turn into one bubble. Own machinery,
not contract: `conversation.input.dock` / `.composer.dock` / `.input.left` /
`.input.right` — their `InputZone` share is an OWNER share Amiba passes at its
own dispatch site (as it already does for `conversation.input.plan`), and the
blockers are two `InputState` members Amiba must first make truthful,
`occurrences` (one U+FFFC placeholder per entry) and `imageIds` (a
browser-owned draft id space). Not the `sessions.provide` channel — see
`src/slots.ts` for the corrected record, including why a faithful
`useInput`/`inputActions` bundle is out of reach entirely.
See `src/slots.ts` for the field-level record. The ui-conversation members of the session standard kit
(`useInput`/`inputActions`) are type-visible but NOT provided by Amiba's
runtime yet (recorded Phase-2 deferral) — the framework members
(`sessionId`/`useSession`/`useProjection`) are live.

It does not expose Electron, `window.amiba`, a custom manifest, a WebView
bridge, or an alternate plugin lifecycle. DSH/Cordis remains the loader and
runtime.

```ts
import type {} from "@amiba/extension-sdk"

ctx.slots.inject("conversation.session.header.utilities", () =>
  ctx.slots.register(
    { name: "conversation.session.header.utilities", id: "example.status" },
    StatusContribution,
  ),
)
```

A Client plugin may also become a slot owner. Declare the child key through
normal TypeScript module augmentation, include it in the parent's `children`,
and render it through `PropsRenderSlots`:

```tsx
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "example.panel.footer": { kind: "list"; scope: "root" }
  }
}

ctx.slots.register(
  {
    name: "settings.section",
    id: "example.panel",
    children: {
      "example.panel.footer": { kind: "list", scope: "root" },
    },
  },
  ExamplePanel,
)
```

`ExamplePanel` receives `renderSlot("example.panel.footer", {})`; another DSH
Client plugin can inject that child in the same way it injects an Amiba root
slot. Nesting is owned and authorized by DSH's slot ledger—Electron does not
need to know the child name.

### 执行生命周期展示与调用定位

UI Shell 提供单实例 `amiba.tool.execution` 槽，owner 为原 `ToolCallOwnerProps`
加 `fallback: ReactNode`。它包围既有 `tool.call.toolview` 分发，允许执行生命周期
插件依据精确调用身份提供持续状态；不接管的调用必须返回 fallback。
`presentation: "summary"` 的内联、非交互要求仍然适用。

工具 owner 的 `revealToolCall(callId)` 用于定位已载入的原调用，核心先展开所属执行组，
再滚动至工具行。目标行收到 `revealVersion` 后可以打开自己的详情。工作台的
`inspectToolCall` 同样定位原调用。此 API 不创建新的执行记录，也不根据工具参数猜测身份。

### Empty-state visual replacement

`amiba.emptyState.visual` is a root-scoped **list** slot. It replaces only
an empty state's visual; the host retains its text, composer, buttons and
navigation. It is available in the shell's HomeView, the ChatSurface hero
fallback, and the workspace empty state. Compact composer-only Quick Ask
has no hero and does not dispatch this slot.

The owner is `EmptyStateVisualOwner`:

- `scene`: `home`, `conversation`, or `workspace`. This identifies the render
  site, not a session id. The main window uses HomeView (`home`) when no
  conversation is selected.
- `defaultVisual`: the host's original visual. Return it for unsupported
  scenes. Returning `null` intentionally leaves the visual empty.

```tsx
ctx.slots.inject("amiba.emptyState.visual", () =>
  ctx.slots.register(
    { name: "amiba.emptyState.visual", id: "my-welcome", label: "My welcome" },
    ({ scene, defaultVisual }) =>
      scene === "home" ? <MyWelcomeIllustration /> : defaultVisual,
  ),
);
```

Declare `@amiba/dsh-plugin-ui-shell` in the plugin's client dependencies,
import the SDK SlotMap types, and release registration on unload through
DSH's scoped injection lifecycle. The host default is a dispatch fallback,
not a registered occupant. Plugins register uniquely identified candidates. Users
choose one provider per surface in Settings → General; installing a plugin does
not replace the default automatically. Choices persist in platform storage.
An unavailable selected provider falls back to the host default (or an empty
accessory/message region), without silently choosing another plugin.

This interface has no Mofli dependency and does not constrain the visual to a
pet. Its optional `interaction` is a read-only subscription to its nearest
host region (see below). A root-scoped registration does not authorize access
to any conversation's data.

### Composer accessory and regional activity

`amiba.composer.accessory` is a root-scoped **list** slot for persistent
compact content perched on the composer’s upper-right edge, with a small visual gap.
The host reserves an 80px-wide region, clips overflow at 80px high, moves it away from visible menus and popovers, and hides it if no clear on-screen position exists. An empty slot takes no space. Content
must fit this region; do not use portals or fixed positioning to escape it.
The official `conversation.input.overlay` still belongs to menus positioned
against the composer card, independently of this accessory region.

All three visual slots receive an optional `SurfaceInteraction`:

```tsx
const snapshot = useSyncExternalStore(
  interaction.subscribe,
  interaction.getSnapshot,
  interaction.getSnapshot,
);
```

Only call this hook in a child rendered when `interaction` is defined.
`snapshot.pointer` is null outside the region, otherwise `{ x, y }` in [-1, 1]
relative to the **whole host region**, not the plugin component. Y increases
downwards. `snapshot.input` contains `focused`, `active`, and `composing`.
Input activity is driven by actual editor DOM beforeinput/input events (including paste
and IME), stops after 650ms of quiet, and resets on editor blur. Composition
stays active until composition ends or focus leaves. No key values or input
text are exposed; handlers neither prevent default behavior nor move focus.

HomeView and ChatSurface own independent region stores with cleanup on
unmount. Plugins must unsubscribe on unmount and should update animation
controllers directly rather than rerendering a large tree on each pointer
move. Standalone hosts without these providers have no subscription.
This is regional input observation, not a global keyboard hook.

### Session activity and coordinated presentation

All three visual owners also expose optional `activity` and `presentation`.
`activity` is available inside ChatSurface and follows the existing engine
snapshot/event handlers. It is not a second execution controller and adds no
engine subscription. Its read-only snapshot contains `sessionId`, `phase`,
`restored`, and `revision`; subscribe using the same external-store pattern
as regional input. HomeView currently has no session activity feed.

Phases are `idle`, `thinking`, `responding`, `tooling`, `waiting`, `completed`,
`failed`, and `interrupted`. Pending questions/approvals take precedence;
parallel running tools stay `tooling` until all finish. A failed individual
tool does not mean the entire turn failed. Terminal phases use actual engine
events, never “streaming stopped” inference. Snapshots have `restored: true`:
render the recovered state without treating it as a new celebration. Text,
reasoning contents, arguments, and results are not included. Background jobs
are not part of this session-turn projection.

`presentation.claim(group, priority)` is cooperative arbitration across the current
product window, including `shell.overlay`. Use a stable plugin-owned group (e.g. `my-plugin.companion`)
for components that must not react simultaneously. Higher priority wins;
equal priorities retain registration order. Different groups are independent.
The returned lease provides `getSnapshot(): boolean`, `subscribe`, and
`release`. Claim in an effect, subscribe to changes, and release on cleanup:

```tsx
useEffect(() => {
  if (!presentation) return;
  const lease = presentation.claim("my-plugin.companion", 10);
  const update = () => controller.setEnabled(lease.getSnapshot());
  const unsubscribe = lease.subscribe(update);
  update();
  return () => { unsubscribe(); lease.release(); controller.setEnabled(false); };
}, [presentation, controller]);
```

The host disables all leases when its region leaves the viewport (via
IntersectionObserver) or the document is hidden, and re-elects on return.
Plugins must honor the lease to pause their animations/reactions; the host
cannot stop an arbitrary component's private timer. The lease is separate from provider selection, and is not an exactly-once event
queue or a cross-window election. Global overlay components can obtain the same
coordinator through `usePresentationCoordinator` from
`@amiba/dsh-plugin-ui-shell/client`. Use the owner's coordinator for regional
components: it additionally tracks that individual presentation's visibility.

### Message decorations

`amiba.message.decoration` is a root-scoped list slot with one user-selected
provider. It renders after normal assistant reply bubbles, outside the bubble;
it does not replace message text, execution folds or tool output. Its
`MessageDecorationOwner` includes `messageId` (Amiba UI identity), `sessionId`,
`streaming`, and the optional interaction/activity/presentation subscriptions.
Each decoration has its own visibility boundary. Content occupies at most
96px, with clipped overflow. No provider means no extra space.

### Integration verification

Run `pnpm --dir apps/desktop test:surfaces` from the repository root. This opens
an isolated Electron fixture with the real DSH slot renderer, Composer,
MessageTurns and provider settings. A development-only probe plugin exercises
selection, persistence, unload fallback, regional pointer/input/composition,
keyboard activation, session recovery and presentation arbitration. Engine
events and composition events are injected test data; this does not exercise a
live agent or the operating system's IME candidate window. The probe is excluded
from the production build and requires no Mofli package.
