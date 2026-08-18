# Amiba

Amiba is a DSH-native desktop agent workspace. DeepSeek Harness owns the agent
runtime, sessions, event stream, context assembly, models, presets, tools,
approvals, questions, skills, MCP clients, and schedules. Electron owns the
desktop shell and narrowly scoped native bridges. Product capabilities that
need agent lifecycle access run as Cordis plugins inside DSH.

This repository intentionally has one runtime path. There is no compatibility
gateway, Python sidecar, browser-extension runtime, transcript fallback, or
dual-write migration layer.

## Architecture

```text
React UI
   │ typed PlatformAdapter / ChatEngineClient
Electron main
   ├─ managed DSH process ── official DSH HTTP + WebSocket APIs
   │     ├─ native sessions, tools, models, presets, skills, MCP, schedules
   │     └─ @amiba/dsh-bundle-amiba (composition only)
   │           ├─ @amiba/dsh-plugin-model-plane (canonical plane + DSH projection)
   │           ├─ @amiba/dsh-plugin-memory
   │           ├─ @amiba/dsh-plugin-messaging-core
   │           ├─ @amiba/dsh-plugin-messaging-channel-webhook
   │           ├─ @amiba/dsh-plugin-attachments
   │           ├─ @amiba/dsh-plugin-mcp-manager
   │           ├─ @amiba/dsh-plugin-runtime-inventory
   │           ├─ @amiba/dsh-plugin-browser-core
   │           ├─ @amiba/dsh-plugin-browser-provider-cdp
   │           ├─ @amiba/dsh-plugin-browser-provider-electron
   │           └─ other independent dsh-plugin-* packages
   ├─ authenticated native operation gateway (no plugin/tool registry)
   ├─ process-wide DSH telemetry
   └─ filesystem, windows, notifications, native-image staging, visible browser,
      terminals, external inbox, screen capture, and workspace checkpoints
```

The detailed ownership model, capability decisions, memory design, security
boundaries, and rollout plan are documented in
[`docs/2026-08-15-dsh-native-architecture.md`](docs/2026-08-15-dsh-native-architecture.md).
The physical application-runtime consolidation is audited in
[`docs/2026-08-15-app-runtime-consolidation.md`](docs/2026-08-15-app-runtime-consolidation.md).

## Workspace

- `apps/desktop`: Electron interaction layer consuming the shared app runtime.
- `apps/cli`: task, Web, and DSH plugin-development CLI using that same runtime.
- `packages/app-runtime`: shared domain types, platform contracts, protocol,
  DSH client, DSH distribution composition, pinned Node/DSH runtime, and the
  harness-independent Model Plane domain module. Its `dsh-runtime` submodule
  owns preparation, verification, profile paths, and integration smoke checks.
  Durable ownership and DSH projection live in `dsh-plugin-model-plane`.
- `plugins/dsh-plugin-*`: independently versioned Cordis plugin projects. Each
  functional module owns its DSH services/tools and declares inter-plugin
  dependencies explicitly.
- `bundles/dsh-bundle-amiba-*`: ordering and configuration only; these compose the
  independent plugins into the Amiba DSH profile.
- `packages/ui`: the existing Amiba interface, adapted to DSH contracts.
- `packages/extension-sdk`: public Amiba contracts for DSH plugin authors.

## Managed runtime

CLI, Web, and Electron do not discover a system DSH or use system Node to run
DSH. Their shared runtime is pinned to:

- DSH `0.1.0-rc.6`
- source commit `47f943859bef60e4160492346772ded9b24f765a`
- Node.js `22.22.0`
- Amiba plugin revision `2026-08-16.2`
- plugin-installer pnpm `9.12.0` (bundled with the managed runtime)

The exact values live in
[`packages/app-runtime/dsh-runtime-manifest.json`](packages/app-runtime/dsh-runtime-manifest.json).
The prepared runtime under `packages/app-runtime/resources/dsh-runtime/`
is generated and ignored by Git. Desktop packaging copies that shared artifact
into the application instead of owning a second runtime.

The Plugins settings page reads the official DSH Loader inventory and can
install npm packages or CLI-produced `dsh-plugin.tgz` archives. Install,
update, and removal delegate to `dsh plugin --profile web`; Amiba then restarts
and reads the newly composed Host/Client graph. Electron keeps no second
plugin registry.

For browser execution in CLI/Web, start Chrome or Chromium with remote
debugging and set `AMIBA_BROWSER_CDP_URL=http://127.0.0.1:9222`. With no
endpoint, the CDP provider registers nothing and browser tools are absent from
that runtime's effective catalog. Electron automatically registers the
higher-priority visible-browser provider.

## Development

Requirements: Node.js `^22.19.0` or `>=24.0.0`, pnpm 9, and macOS for the
fresh-profile harness.

```bash
pnpm install
pnpm runtime:prepare
pnpm dev:desktop
```

Useful verification commands:

```bash
pnpm runtime:verify
pnpm runtime:smoke
pnpm -r typecheck
pnpm -r --if-present test
pnpm build:desktop
```

Run a fully isolated first-launch profile with:

```bash
pnpm dev:desktop:fresh
pnpm dev:desktop:fresh:keep
```

## Deliberate cuts

The migration removes features whose lifecycle could not be made DSH-native:
the Python service plane, standalone browser extension target, voice/STT,
Kanban/task-center projection, virtual-model orchestration, old runtime plugin
management, legacy transcript import/rewind, and first-class MCP
resources/prompts. New agent-facing capabilities must be implemented as their
own `dsh-plugin-*` projects. OS execution remains behind narrow, testable
platform operations; it does not own or publish DSH tool definitions.
