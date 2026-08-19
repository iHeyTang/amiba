# @amiba/extension-sdk

Public authoring contracts for DSH plugins targeting the Amiba Web Shell.

The SDK exports typed Host/Client helpers, stable Amiba root child-slot names,
owner/injection types, and the `SlotMap` declaration merge used by DSH's
official slot service.

Vocabulary policy: a seat with an official DSH equivalent uses the OFFICIAL
slot name and inherits the official contract — `settings.section` (owner
`SettingsSectionOwnerProps { close }`, re-exported here) comes from
`@deepseek-ai/dsh-client-ui-settings`, `shell.overlay` from
`@deepseek-ai/dsh-client-ui-layout`, the `conversation.*` family from
`@deepseek-ai/dsh-client-ui-conversation`, and `tool.call.toolview` from
`@deepseek-ai/dsh-client-ui-tool`. Five seats are adopted from those last two
packages, with their owner contracts re-derived here:

| seat | kind / scope | owner | render site |
| --- | --- | --- | --- |
| `conversation.session.header.utilities` | list / session | `ConversationHeaderUtilitiesOwnerProps` (empty) | right-aligned strip in the chat header (replaced the retired `amiba.chat.header.after`) |
| `conversation.session.header.actions` | list / session | `ConversationHeaderActionsOwnerProps` (empty) | title-adjacent action row in the chat header |
| `conversation.input.model` | single / session | `ConversationInputModelOwnerProps` (`{ locked }`) | composer tool row, left of the send button |
| `conversation.input.plan` | single / session | `ConversationInputPlanOwnerProps` (`{ locked }`) | composer tool row, immediately right of the access-mode control |
| `tool.call.toolview` | **keyed** / session | `ToolCallToolviewOwnerProps` (= the official `ToolCallOwnerProps`) | one tool call row inside a turn, dispatched by the wire tool name |

Both header seats and both composer seats render NOTHING while unoccupied —
no placeholder, no reserved space, no flex gap. `tool.call.toolview` is
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
    ({ block, cwd, openFile }) => <MyTerminalCard block={block} cwd={cwd} onOpen={openFile} />,
  ),
)
```

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
with no render site. Three seats are NOT adopted yet, for two different
reasons. Contract Amiba genuinely cannot supply today:
`conversation.input.dock` / `.composer.dock` / `.input.left` / `.input.right`
(the `InputZone` share needs the ui-conversation input machine) and
`conversation.chat.turnTail` (`TurnLocation` is an engine-owned boundary with
a business-value reader over machinery Amiba does not run). Render site, not
contract: `conversation.chat.assistant-actions`, whose `MessageId` is on the
wire but whose render site folds a whole turn into one bubble.
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
