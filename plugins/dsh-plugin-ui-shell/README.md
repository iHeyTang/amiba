# @amiba/dsh-plugin-ui-shell

Amiba's DSH browser root plugin. Its Host half exists only for normal DSH
client-package discovery. Its Client half replaces the stock `ui-layout`
entry, provides the `layout` service required by the DSH Web Shell, owns the
single `root` registration, and declares Amiba's stable semantic child slots.

Electron and the Web Shell intentionally keep separate React runtimes. The
plugin owns a DOM root inside the DSH tree; the existing Amiba surface mounts
its React root there. DSH-rendered children use portals into semantic slot
targets inside that surface. No React component crosses the runtime boundary,
and Electron never registers plugin content in reverse.

## Stable children

- `amiba.navigation.before`
- `amiba.navigation.after`
- `amiba.workspace.navigation`
- `amiba.workspace.view`
- `amiba.chat.header.after`
- `amiba.chat.content.overlay`
- `amiba.settings.navigation.before`
- `amiba.settings.navigation.assistant`
- `amiba.settings.navigation.after`
- `amiba.settings.section`
- `amiba.settings.content.overlay`
- `amiba.shell.overlay`

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
plugins may also declare their own nested `children`; `amiba.tools.panel` is
the current example of a feature-owned child slot.
