# @amiba/app-runtime

[中文版](./README.zh-CN.md)

Shared application-domain code used by Amiba's renderer surfaces (desktop and
the DSH Web Shell) and the Electron main process. It is the one package that
owns the platform contract, the product protocol, and the DSH client and
distribution machinery — everything a surface needs to talk to the agent
runtime without knowing which host it runs in.

## Structure

Each public subpath maps to one module under `src/`:

| Subpath | Module | What it owns |
| --- | --- | --- |
| `./platform` | `src/platform` | The `PlatformAdapter` contract: a runtime-independent capability surface (storage, shell, engine-native session/model/preset/settings/credential/permission projections, desktop-only workspace bridges). Each app installs its own implementation at boot via `setPlatform()`. Contains **mechanisms and engine-native shapes only** — domain adapters (memory, skills, MCP, messaging, schedules, usage, model plane…) live in their `dsh-plugin-*` packages, enforced by `scripts/verify-pluginization.mjs`. |
| `./protocol` | `src/protocol` | The stable product protocol between Amiba surfaces and the selected agent runtime (chat roles, message/turn/step shapes). Deliberately free of adapter implementation types; runtime adapters translate their native event stream at this boundary. |
| `./core` | `src/core` | Shared application state and services consumed by the UI: sessions and session-history projection, the chat-engine client protocol, agent presets and context, attachments, runtime permissions, config, channels, wallpaper. |
| `./dsh-client` | `src/dsh-client` | The DSH API client and its glue: `DshApiClient` (RPC + events.mux), the Amiba event bridge, the chat-engine adapter, `createDshPlatformAdapters` (wires the engine-native platform surfaces onto the client), and the web-platform composition used by the official Web Shell. |
| `./dsh-distribution` | `src/dsh-distribution` | The Core/Web/Desktop profile contract: bundle identities (`@amiba/dsh-bundle-amiba-{core,web,desktop}`), profile names, and manifest composition. Pure data shipped as prebuilt `.js`/`.d.ts` so browser consumers never load Node code. |
| `./dsh-runtime` | `src/dsh-runtime` | Node-only management of the pinned Node/DSH artifact: staging preparation and verification, profile lifecycle, and application packaging paths. Reads `dsh-runtime-manifest.json`; exported from the `dist/` build. |
| `./dsh-runtime-manifest` | `dsh-runtime-manifest.json` | The pin manifest (DSH version, Node version, bundle set) consumed by staging and packaging. |
| `./utils` | `src/utils` | Pure helpers with no platform or DSH dependency. |

`dsh-distribution` and `dsh-runtime` stay separate on purpose: the former is
the browser-safe profile contract, the latter owns the Node-side artifact —
both describe the same distribution, from two sides of the process boundary.

Supporting top-level paths:

- `resources/dsh-runtime/` — the staged managed runtime (gitignored build
  output; refresh with `pnpm runtime:rebuild`, then fully restart the app).
- `scripts/` — staging, verification, and the bundle-composition smoke script
  (`scripts/dsh-runtime/smoke.mjs`, which may reference plugin packages by
  name because it verifies the shipped bundle).
- `dist/` — build output for the Node-only `dsh-runtime` subpath.

## What is intentionally not here

Plugin loading, model plane (providers/credentials/discovery and the composer
model picker), model tools, MCP providers, schedules, skills, memory, usage
metering, messaging, and UI slot lifecycle are not implemented here. Those
capabilities live in separate `dsh-plugin-*` packages and are composed by the
independent `@amiba/dsh-bundle-amiba-core`, `-web`, and `-desktop` layers.

There is also no Extension Host, Managed Extensions runtime, WebView bridge,
or MCP subprocess host in this package.
