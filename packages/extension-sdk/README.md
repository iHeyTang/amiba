# @amiba/extension-sdk

Public authoring contracts for DSH plugins targeting the Amiba Web Shell.

The SDK exports typed Host/Client helpers, stable Amiba root child-slot names,
owner/injection types, and the `SlotMap` declaration merge used by DSH's
official slot service.

Vocabulary policy: a seat with an official DSH equivalent uses the OFFICIAL
slot name and inherits the official contract — `settings.section` (owner
`SettingsSectionOwnerProps { close }`, re-exported here) comes from
`@deepseek-ai/dsh-client-ui-settings`, `shell.overlay` from
`@deepseek-ai/dsh-client-ui-layout`, and the `conversation.*` family
(`conversation.session.header.utilities` — replacing the retired
`amiba.chat.header.after` — and `conversation.input.model`, whose owner
contracts are re-derived here as `ConversationHeaderUtilitiesOwnerProps` and
`ConversationInputModelOwnerProps`) from
`@deepseek-ai/dsh-client-ui-conversation`. `amiba.*` names are reserved for
vendor extensions with no official counterpart; only those appear in
`AMIBA_ROOT_SLOTS`. Importing this SDK makes the official names visible in
`SlotMap` — plugins need no extra dependency. Note the inheritance makes ALL
conversation.* keys type-visible while Amiba runtime-declares only the two
adopted seats: registering into an undeclared key waits in `ctx.slots.inject`
with no render site. The ui-conversation members of the session standard kit
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
