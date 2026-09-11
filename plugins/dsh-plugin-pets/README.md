# Amiba Pets

A DSH plugin integrating the published `@mofli/core`, `@mofli/grove` and
`@mofli/studio` packages (pinned to 0.1.1). Amiba core has no Mofli dependency.

Open **Pets** in the workspace navigation to create, name, preview and save
multiple pets. Select a skin and accessories, test activity states and rig
guides, import Studio's `pet.json`, or export a configuration for another app.
Choose an active companion, then select **Pets** under Settings → General for
the empty-state and/or composer accessory surfaces. During a conversation the
companion perches on the composer’s upper-right edge. The host moves it away from popovers and hides it when no clear position is available. A visible empty-state
companion takes precedence, so the two never appear together. Pets do not register
message decorations.

**Open Studio** serves the installed Studio production build on a loopback port and displays
its isolated React application inside Amiba. Export `pet.json` there and import
it into the pet library. Studio is local to the Amiba runtime host; remote-browser
access to a different machine's loopback Studio is not supported. The loopback server is stopped when the plugin unloads. Studio does not share Amiba's React
runtime and does not automatically write into the library.

**Create with Agent** starts a conversation with the creation workflow.
The agent has `pets_catalog`, `pets_list`, `pets_save`, `pets_activate`, and
`pets_delete`; these use the same validated, durable library as the UI.
Creation assembles trusted Grove resources, including user-authored skin data
compatible with those rigs. Configuration cannot import executable rigs or
accessory code; adding another trusted resource pack is plugin development.

The configured `root` contains `pets.json`. Mutations are serialized and written
atomically. Browser surfaces share one library subscription/poll (2 seconds
while visible), so Agent changes appear without reopening the page. Pointer,
input, session activity and visibility use Amiba's shared surface contracts;
Mofli owns hit testing and click reactions. The presentation group
`mofli.companion` elects one reacting surface within a window. Hidden documents
cancel animation frames. Message decorations do not replace message contents.

```sh
pnpm --dir plugins/dsh-plugin-pets typecheck
pnpm --dir plugins/dsh-plugin-pets test
pnpm --dir plugins/dsh-plugin-pets build
pnpm --dir apps/desktop test:pets
```

The Electron smoke uses the real DSH renderer, published Mofli packages and a
temporary on-disk library. Its HTTP fixture substitutes for the DSH Remote
transport; Agent tools are tested directly, without invoking a paid model.

Companions use Amiba-owned expression sequences for typing, thinking, responding, tools, approval waits, completion, failure and interruption. Completion reactions play once; restored history stays calm. The Grove showroom sequence is disabled on companion surfaces.
