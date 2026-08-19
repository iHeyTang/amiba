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
- `settings.section` — official name and owner contract
  (`SettingsSectionOwnerProps { close }`) inherited from
  `@deepseek-ai/dsh-client-ui-settings`; registrant options (`id`, `order`,
  `label`) drive the Settings navigation ledger, and the vendor `navIcon`
  inject-face convention still supplies the nav glyph (official plugins
  without one fall back to the generic Blocks icon)
- `amiba.settings.content.overlay`
- `shell.overlay` — official name from `@deepseek-ai/dsh-client-ui-layout`:
  the frame-wide click-through floating layer

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
