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

Declared on the root's children table:

- `amiba.navigation.before`
- `amiba.navigation.after`
- `amiba.workspace.navigation`
- `amiba.workspace.view`
- `amiba.chat.header.after`
- `amiba.chat.content.overlay`
- `amiba.composer.modelPicker` (dispatched through the composer's
  `modelPicker` render prop)
- `amiba.settings.navigation.before`
- `amiba.settings.navigation.assistant`
- `amiba.settings.navigation.after`
- `amiba.settings.section`
- `amiba.settings.content.overlay`
- `amiba.shell.overlay`

`amiba.agentPreset.section` remains part of the public vocabulary
(`@amiba/extension-sdk`) but its runtime declaration lives on
`dsh-plugin-agent-preset`'s settings-section entry, which dispatches it with
`renderSlot` — the same feature-owned child-slot pattern as
`amiba.tools.panel`.

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
  ctx.slots.inject("amiba.chat.header.after", () =>
    ctx.slots.register(
      {
        name: "amiba.chat.header.after",
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
