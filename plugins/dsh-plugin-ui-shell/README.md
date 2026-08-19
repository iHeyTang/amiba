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
  flex gap
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
- `settings.section` — official name and owner contract
  (`SettingsSectionOwnerProps { close }`) inherited from
  `@deepseek-ai/dsh-client-ui-settings`; registrant options (`id`, `order`,
  `label`) drive the Settings navigation ledger, and the vendor `navIcon`
  inject-face convention still supplies the nav glyph (official plugins
  without one fall back to the generic Blocks icon)
- `amiba.settings.content.overlay`
- `shell.overlay` — official name from `@deepseek-ai/dsh-client-ui-layout`:
  the frame-wide click-through floating layer
- `tool.call.toolview` — official name from
  `@deepseek-ai/dsh-client-ui-tool`: the per-tool call row, KEYED by the wire
  tool name (keyed, SESSION scope, owner `ToolCallOwnerProps`). The only seat
  here whose occupants are not a fixed list — the key domain is open, so a
  plugin registers `key: "<wire tool name>"` and owns how that tool's calls
  render inside a turn. Every unclaimed name renders Amiba's own
  `ToolSpec`-driven tool chip, which the shell passes as the dispatch
  `fallback`, so with no plugin registered the conversation is byte-identical
  to before the seat existed. Owner supply: `callId` / `toolName` / `block`
  come from the row (the `block` is rebuilt from the verbatim wire material
  both Amiba tool producers retain), `cwd` from the conversation's workspace
  binding, `openFile` from the workspace pane. `inspect` is deliberately
  omitted — it addresses the trajectory view, which Amiba does not run

DECLARATION-ANCHOR divergence, for the one seat that has one: upstream
declares `tool.call.toolview` from `conversation.chat.node`'s `tool-call`
entry, the Chat Node that owns the whole call tree. Amiba has no such entry
(its conversation is its own projection), so the seat is declared on this
root instead. Legal, and the same pattern the adopted `conversation.*` seats
already use; only the declaration SITE differs — the key, kind, scope, and
owner contract are the official ones.

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
