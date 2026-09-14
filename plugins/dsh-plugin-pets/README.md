# Amiba Pets

A DSH plugin integrating the `@mofli/core` and `@mofli/grove` 0.2.0 offline packages
(see [vendor provenance](vendor/README.md)) and published `@mofli/studio` 0.1.1. Amiba core has no Mofli dependency.

Open **Settings → Pets** to create, name, preview and save
multiple pets. Select a skin and accessories, test activity states and rig
guides, import Studio's `pet.json`, or export a configuration for another app.
Choose an active companion to show it on the empty page by default.
Settings → General lets you select a different surface provider or turn that display off.

On desktop, **Show desktop pet** opens an independent transparent, always-on-top
companion overlay. Drag the pet across the full screen, including the Dock area.
The native host stays fixed while the pet moves, and placement uses the visible
artwork bounds rather than SVG padding. Right-click **Resize…** to show a frame,
drag any corner to scale continuously, then click the checkmark to finish. The
menu also switches pets, opens Amiba and hides the desktop pet. Position, size and visibility are
saved across launches. Desktop visibility and in-app companion surfaces are independent:
either can be enabled or disabled without changing the other. They share the pet
library and active pet, and desktop reactions follow Amiba's session activity.
The desktop pet looks toward the cursor anywhere on screen, returning to a neutral
pose if cursor updates become unavailable.

Desktop status cards belong to the pet plugin. They show conversation progress and
link back to the corresponding chat. Completion cards remain until dismissed or
the session is marked read; switching conversations and restarting Amiba retain
unacknowledged cards. Restoring an old conversation does not create new completion
cards. Cards use a stable anchor independent of the animated silhouette and move
below the pet when there is insufficient room above it. Multiple cards appear as
a collapsed stack; hovering expands the stack, and leaving collapses it again.
Bubbles use a compact single line with an inline Dismiss action on hover. Plugin
copy follows Amiba’s active English/Chinese locale, as does the native pet menu.

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
cancel animation frames.

```sh
pnpm --dir plugins/dsh-plugin-pets typecheck
pnpm --dir plugins/dsh-plugin-pets test
pnpm --dir plugins/dsh-plugin-pets build
pnpm --dir apps/desktop test:pets
AMIBA_TEST_DESKTOP_PET=1 node apps/desktop/scripts/smoke-pets.mjs
```

The Electron smoke uses the real DSH renderer, published Mofli packages and a
temporary on-disk library. Its HTTP fixture substitutes for the DSH Remote
transport; Agent tools are tested directly, without invoking a paid model.

Companions use Amiba-owned expression sequences for typing, thinking, responding, tools, approval waits, completion, failure and interruption. Completion reactions play once; restored history stays calm. The Grove showroom sequence is disabled on companion surfaces.

## Desktop notifications

The pet plugin owns its reminder presentation: compact title/status bubbles, fixed anchors, hover stacks and pet reactions. It consumes the independent `amibaNotificationFeed` service and does not own notification storage, transport or session-read synchronization. Other desktop notification plugins may implement entirely different policies and UIs using the same mechanisms.

Closing the desktop pet only pauses its presentation. Unread notifications remain in the center across restarts. The bubble's Ignore action records `dismissedAt`; reading the conversation records `readAt`; the business producer records `resolvedAt` when an approval or question is settled.

## Dependencies and local development

This plugin declares exact published Mofli dependencies. The managed Amiba runtime
installs its registry lock with npm ci; it never injects local library archives.
The capability adapter is an internal build step of this plugin, based on its own
installed dependencies. Published 0.1.1 supports 2D rigs and expression reactions;
unsupported local pet configurations remain on disk until compatible rigs return.

Use DSH's profile dependency resolution, Loader patches and client HMR for local
plugin development. See [the shared plugin development workflow](../../../docs/local-plugin-development.md).
Mofli itself supplies libraries, not a DSH plugin: link those libraries inside the
local pet plugin project, then load that plugin into the development profile.
Nothing is copied into Amiba's managed runtime, and no Mofli-specific mode exists.
To ship new Mofli features, publish the libraries, update this plugin's exact
versions and both dependency locks, then build Amiba.
