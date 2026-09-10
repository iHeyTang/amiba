# @amiba/dsh-plugin-memory-memos

Amiba's built-in local memory, composed from the official
`@memtensor/memos-local-plugin@2.0.18` DeepSeek Harness adapter.

## How it works

The core bundle loads this Amiba plugin, which mounts the official adapter as a
Cordis child plugin. MemOS owns its Core, SQLite database, retrieval, lifecycle
hooks and Viewer in the DSH process. No MemOS cloud account, separate daemon or
global npm installation is required. The Amiba layer owns default configuration,
management RPC, workspace and settings/preset UI and tool provenance. It does not fork the algorithms
or change the DSH plugin loader.

- On the first agent step of each turn, MemOS searches and injects bounded recall.
- Turn completion queues capture; plugin disposal drains pending writes.
- Six upstream tools are available: `memos_search`, `memos_get`, `memos_timeline`,
  `memos_environment`, `memos_skill_list`, `memos_skill_get`.
- Memory namespaces follow DSH agent presets. Different conversations in the same
  preset can share memory; workspace paths are context, not an isolation boundary.
- A new installation seeds **full mode** (`algorithm.lightweightMemory.enabled:
  false`). Existing configuration is never overwritten. Full mode needs model
  scoring for useful recall; successful startup alone does not establish quality.
- The host LLM bridge uses the current task's provider/model and consumes its
  quota. Default embeddings run locally and may download model files on first use.
  Local storage does not imply that model requests stay offline.
- Upstream disables autonomous startup/timed recovery when using the host LLM;
  session-driven processing still runs. Full-mode strategy/skill generation is
  conditional on upstream scoring and thresholds, not guaranteed every turn.

## Configuration and UI

The core bundle stores data under `DSH_HOME/amiba-memos`.
Upstream `MEMOS_HOME` / `MEMOS_CONFIG_FILE` overrides are
respected. `config.yaml` is created with owner-only permissions. Amiba seeds
telemetry off and LLM prompt/completion redaction on.

The settings and agent-preset memory pages show actual engine state and mode, and
link to the official local Viewer (`http://127.0.0.1:18801`). Set
`AMIBA_MEMOS_VIEWER_PORT` to another port when running multiple instances. A port
conflict is surfaced as an error. Restart Amiba after changing configuration.
Model-specific MemOS configuration can override the default host model route.

The plugin registers a **Memory** workspace at the top of the workspace navigation.
Its native Amiba page provides overview counts, category browsing (memories,
experiences, environment knowledge and skills), text search, pagination and
source/content details. It reuses Amiba's theme, controls and desktop chrome.
The existing settings and preset pages retain engine status and the original
Viewer link for advanced configuration and editing.

`amibaMemory/status`, `amibaMemory/overview` and `amibaMemory/browse` expose a
strict typed, read-only projection. The host requests fixed local Viewer routes
with a timeout, validates responses, and never follows redirects. No browser
CORS dependency or secondary store is introduced. Password-protected Viewers show a native password form. `amibaMemory/login`
forwards login to MemOS; its signed session is kept only in the client runtime
and supplied on subsequent reads. Passwords are cleared after submission and
are never persisted. Each client authenticates independently. Browser login
and native dashboard login are separate.

The package is named `@amiba/dsh-plugin-memory-memos`. The existing Cordis entry
ID `amiba-memory`, RPC namespace `amibaMemory`, and data directory `amiba-memos`
remain stable so the rename does not reset configuration or stored memories.

## Packaging and verification

The managed runtime installs MemOS and its native dependencies with its bundled
Node. `npm-overrides.mjs` narrowly pins MemOS's six DSH peers to the host version:
upstream's semver range excludes the host's `0.1.1-rc.2` prerelease. Other peer
validation remains enabled. Recheck this override and the deep import paths on
every upstream upgrade.

Run plugin `typecheck`, `test` and `build` with pnpm. After preparing the runtime,
run the deterministic Core smoke with its Node and dependency tree:

```sh
AMIBA_MEMORY_TEST_APP="$PWD/packages/app-runtime/resources/dsh-runtime/app/package.json" \
  packages/app-runtime/resources/dsh-runtime/node/bin/node \
  plugins/dsh-plugin-memory-memos/scripts/smoke.mjs
```

This smoke uses temporary SQLite storage, a loopback embedding fixture and
deterministic host LLM responses in **full mode** to verify automatic capture,
scoring integration, persistence after restart, cross-session recall, preset
isolation and the search tool without paid LLM calls. It checks the processing
path, not the quality of real model scoring. Unit tests cover defaults and
lifecycle/error reporting; `pnpm runtime:smoke` checks full-mode startup and the
six tools in the real bundled DSH composition.

The memory panel tests verify the external link, disabled/error states and
rejection of non-local or unsafe URLs without launching a browser.
