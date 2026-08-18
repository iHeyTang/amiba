# @amiba/extension-sdk

Public authoring contracts for DSH plugins targeting the Amiba Web Shell.

The SDK exports typed Host/Client helpers, stable Amiba root child-slot names,
owner/injection types, and the `SlotMap` declaration merge used by DSH's
official slot service.

It does not expose Electron, `window.amiba`, a custom manifest, a WebView
bridge, or an alternate plugin lifecycle. DSH/Cordis remains the loader and
runtime.

```ts
import type {} from "@amiba/extension-sdk"

ctx.slots.inject("amiba.chat.header.after", () =>
  ctx.slots.register(
    { name: "amiba.chat.header.after", id: "example.status" },
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
    name: "amiba.settings.section",
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
