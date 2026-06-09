# Plugins Panel — Design

**Date:** 2026-06-09
**Status:** Approved (design)

## Problem

There's no UI to see which Hermes **plugins** are installed and which are
effective (enabled). Today the only way is `hermes plugins list` (CLI) or
reading `~/.hermes/plugins/` + `config.yaml`. We want a panel that shows
installed plugins + their enabled state, with the ability to enable/disable.

## Key distinction (drives the design)

The desktop already has an **Extensions** panel (`SettingsExtensions.tsx`), but
extensions ≠ plugins:

| | desktop **extension** | hermes **plugin** |
|---|---|---|
| runtime | Electron renderer (`@hermes-x/extension-host`) | hermes agent process (Python) |
| data | `window.hermes.extensions` (IPC) | new `/hermes/plugins` (backplane) |
| install | marketplace | `hermes plugins` / `~/.hermes/plugins/` + config |
| where | desktop only | wherever the backplane runs (web / ext / desktop) |

So the merge is **presentation-layer**: one panel, two *types*, two data
sources behind it — NOT a unified data model.

## Decisions (locked)

- **Scope:** read + enable/disable (no install/remove from the UI — that stays
  with the `hermes plugins` operator CLI).
- **Merge:** approach (A) — keep one panel (`SettingsExtensions`) with two
  type-labelled sections: `Extensions` (existing) and `Plugins` (new). Each
  keeps its native actions. Not a single unified row model (approach B).
- **Authority:** read plugin state via hermes-agent's own
  `hermes_cli.plugins.get_plugin_manager().list_plugins()` — same source as
  `hermes plugins list`, no second code path / drift.
- **Host:** Plugins section shows wherever the backplane is reachable;
  Extensions section is desktop-only (no `window.hermes.extensions` elsewhere).

## Architecture (3 layers)

### 1. Backplane — `hermes_proxy/plugins_routes`

- `GET /hermes/plugins` → `{ plugins: [...] }`, passing through
  `get_plugin_manager().list_plugins()`:
  `{ name, key, kind, version, description, source, enabled, tools, hooks,
  commands, error }`. Import is lazy + guarded — if `hermes_cli.plugins` isn't
  importable (e.g. unit tests outside a Hermes process), return `{plugins: []}`.
- `POST /hermes/plugins/enable` and `/disable` (body or query `?key=`/`?name=`)
  → mutate `config.yaml` via `hermes_cli.config.load_config`/`save_config`:
  - **enable**: add name to `plugins.enabled`; remove from `plugins.disabled`.
  - **disable**: remove from `plugins.enabled`; add to `plugins.disabled`
    (deny-list — needed because bundled plugins auto-load regardless of the
    allow-list).
  Respects `is_managed()` (refuse writes on managed configs → 409). Returns the
  updated `{enabled, disabled}` membership for the key.
- Lifecycle note: most plugins only (un)load on the next agent start — the
  endpoint does NOT hot-reload. Response carries `applies_on_restart: true` so
  the UI can say so.

Registered in `hermes_proxy/__init__.py` alongside the other lanes. Mirrors the
existing `settings`/`integrations_gateway` module shape.

### 2. Core — `packages/core/src/hermes-plugins.ts`

- `HermesPlugin` type (the row shape above) + `HermesPluginsResponse`.
- `getHermesPlugins(): Promise<{ ok, plugins: HermesPlugin[] }>` over
  `backplaneFetch("/hermes/plugins")` (same pattern as `hermes-skills.ts`).
- `setPluginEnabled(key, enabled): Promise<{ ok, applies_on_restart }>` →
  POST enable/disable. Export from `index.ts`.

### 3. UI — `SettingsExtensions.tsx` gains a Plugins section

- Add a `PluginsSection` rendering `getHermesPlugins()`: a list with
  name + source/kind badge + version + description + an **enable/disable
  toggle** (calls `setPluginEnabled`, optimistic, then refetch). Group/sort:
  enabled first, then by name.
- After a toggle, show an inline "重启 Hermes 生效 / restart to apply" hint
  (since it's config-only, not hot-reload).
- The panel keeps the existing Extensions UI above; the new Plugins section
  below, each under a clear type heading. On non-desktop hosts the Extensions
  section already no-ops (no bridge); Plugins section still renders.
- i18n keys under `options.plugins.*` (mirror `options.extensions.*`).

## Error handling

- Backplane down / endpoint 5xx → Plugins section shows an inline error +
  retry, never throws (mirror `getHermesSkills`'s degrade-to-empty).
- `hermes_cli.plugins` not importable → `{plugins: []}` (empty section, not an
  error).
- Managed config → toggle disabled in UI + tooltip; backplane returns 409.

## Testing

- Backplane: pytest for the enable/disable config mutation (add/remove across
  enabled+disabled, idempotent, managed-config refusal) against a temp
  config; list endpoint returns `[]` when `hermes_cli.plugins` is absent.
- Core/UI: typecheck; light unit on the toggle membership logic if extracted.

## Non-goals / YAGNI

- Install / remove plugins from the UI (operator CLI owns that).
- Hot-reload on toggle (config-only; restart applies).
- Merging extensions and plugins into one data model (they're different;
  type-labelled sections keep them honest).
