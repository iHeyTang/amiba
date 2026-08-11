# Amiba

[English](README.md) | [简体中文](README.zh-CN.md)

Amiba is a desktop client and browser extension built on
[Hermes Agent](https://github.com/NousResearch/hermes-agent). It is a pnpm
monorepo whose apps share core logic, UI, settings, theming, localization, and
platform abstractions.

A separate Hermes source checkout is optional and may live anywhere. Amiba
uses it only when a developer explicitly selects it for local debugging.

## Workspace

```text
amiba/
├── apps/
│   ├── browser-extension/ # Browser extension
│   ├── cli/               # Extension development CLI
│   └── desktop/           # Electron desktop app
├── backend/               # Local Amiba backend
├── packages/              # Shared packages
├── package.json
└── pnpm-workspace.yaml
```

The applications are:

- `apps/browser-extension` — the browser extension.
- `apps/desktop` — the Electron desktop client.
- `apps/cli` — the `amiba` command for creating, developing, packaging, and
  installing Amiba Desktop extensions and mention sources.

The main shared packages are:

- `packages/core` — chat protocol, Hermes client, and business logic.
- `packages/chat-ui` — shared chat interface.
- `packages/settings-ui` — shared settings interface.
- `packages/platform` — browser and Electron platform abstractions.
- `packages/ui`, `packages/theme`, and `packages/i18n` — UI primitives, themes,
  and localization.

## Requirements and installation

- Node.js 20 or newer
- pnpm 9 or newer

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install
```

## Development

Start the browser extension:

```bash
pnpm dev:browser-extension
```

Prepare the managed Hermes Runtime once, then start the desktop app:

```bash
pnpm runtime:prepare
pnpm dev:desktop
```

Normal Amiba UI or desktop code changes do not require rebuilding the Hermes
Runtime.

## Managed Hermes Runtime

Amiba Desktop ships and runs its own Hermes Runtime. It does not use a
system-installed Hermes, Python, or Node, and it does not modify a developer's
local Hermes source checkout.

```text
Runtime manifest
      ↓ runtime:prepare
Complete immutable Runtime in project or installed app
      ↓
Run Hermes directly

Amiba user data
      ↓
Writable HERMES_HOME only
```

There are three important locations:

- `apps/desktop/hermes-runtime-manifest.json` is the source-controlled build
  declaration. It pins the Hermes commit, Python, Node, and Amiba patches.
- `apps/desktop/resources/hermes-runtime` is the complete generated Runtime and
  the Runtime included in and executed directly from the desktop package.
- Amiba's user-data directory contains only mutable Hermes configuration,
  sessions, logs, skills, and caches under its private `HERMES_HOME`.

Neither a system Hermes nor a separate local Hermes checkout is part of the
normal startup path.

### Inspect the bundled version

```bash
# Print the prepared Runtime summary
pnpm runtime:info

# Verify that the generated Runtime matches the declaration
pnpm runtime:verify
```

### Upgrade bundled Hermes

1. Update the full `commit` and `version` in
   `apps/desktop/hermes-runtime-manifest.json`.
2. Run `pnpm runtime:prepare`.
3. Run `pnpm runtime:verify`.
4. Start the app with `pnpm dev:desktop` and verify the upgrade.

During preparation, each downstream patch is classified automatically:

- `apply` — upstream still lacks the behavior, so the patch is applied and
  verified.
- `retire` — the behavior is now available upstream, so the build stops and
  asks for the obsolete patch to be removed.
- `conflict` — the behavior is still missing, but the patch no longer applies
  and needs a manual rebase.

To force a clean rebuild without changing the manifest:

```bash
pnpm runtime:rebuild
```

### Runtime modes

| Mode                                              | Purpose                                                  | Source actually executed                                  | Patch and verification                           |
| ------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Built-in pinned Runtime (default and recommended) | Normal development, testing, and releases                | Manifest-pinned snapshot under `resources/hermes-runtime` | Automatic                                        |
| Prepared local snapshot                           | Debugging intentional changes in a local Hermes checkout | Staged Runtime under `resources/hermes-runtime`           | Automatic                                        |
| Direct source override (advanced)                 | Rapid temporary source iteration                         | The original source directory                             | Bypassed; the developer guarantees compatibility |

Use the built-in pinned Runtime unless you are actively changing Hermes itself.
Its normal workflow is `pnpm runtime:prepare` followed by
`pnpm dev:desktop`.

### Optional local Hermes source debugging

To test any local Hermes checkout, pass its path explicitly:

```bash
pnpm runtime:prepare:local -- --source /absolute/path/to/hermes-agent
pnpm dev:desktop
```

Amiba copies the source and applies patches to its own staged copy. The original
checkout remains untouched. `dev:desktop` always uses the most recently
prepared Runtime. Run the preparation command again after changing the selected
Hermes source. This is safer than a direct override, but it is intended only for
local Hermes development; it is not the default Amiba workflow.

For a persistent per-developer direct override, copy the example config:

```bash
cp .amiba.local.example.ts .amiba.local.ts
```

Then set the local source path in `.amiba.local.ts`:

```ts
import { defineAmibaConfig } from "./apps/desktop/scripts/desktop-local-config.mjs";

export default defineAmibaConfig({
  hermes: {
    mode: "direct-source",
    source: "/absolute/path/to/hermes-agent",
  },
});
```

`.amiba.local.ts` is ignored by Git and must never be committed. Delete it or
set `hermes.mode` to `built-in` to return to the default Runtime. For a one-time
override, the environment variable has the highest priority.
`defineAmibaConfig` provides field completion, mode suggestions,
documentation, and inline type errors.

```bash
AMIBA_HERMES_DEV_SOURCE=/absolute/path/to/hermes-agent pnpm dev:desktop
```

It still uses Python, Node, and Backplane from the prepared Runtime, but it
bypasses source copying, Amiba patch application, and behavioral verification.
Dependency and protocol compatibility are therefore the developer's
responsibility.

See the [managed Runtime guide](apps/desktop/docs/managed-hermes-runtime.md) for
implementation details.

## Build and package

```bash
pnpm build:browser-extension
pnpm build:desktop
pnpm package:desktop
```

Desktop packaging runs `runtime:prepare` automatically and puts the complete
Hermes Runtime in the installer. Users do not download or install Hermes
separately.

## Architecture

```text
Shared UI and business logic
            │
            ▼
      PlatformAdapter
            │
       ┌────┴────┐
       ▼         ▼
  Browser API  Electron IPC
```

- The browser extension implements platform capabilities with browser APIs.
- The desktop app implements them through Electron IPC and its main process.
- Both apps share chat, sessions, settings, themes, and localization.
- The desktop main process manages the bundled Hermes Runtime and communicates
  with its Gateway through `/v1/runs`.

## Additional documentation

- [Managed Hermes Runtime](apps/desktop/docs/managed-hermes-runtime.md)
- [Backend](backend/README.md)
- [Browser extension](apps/browser-extension/README.md)
