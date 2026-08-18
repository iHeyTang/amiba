# @amiba/dsh-plugin-agent-preset

DSH plugin owning Amiba's agent-preset management UI: the 智能体预设 ("Agent
presets") settings section — preset roster, drill-in detail with the native
行为与人设 ("Behavior & identity") tab, create/rename/delete/set-default, and
the `amiba.agentPreset.section` tab strip other plugins contribute detail tabs
into.

## Shape

- **Host half** (`src/index.ts`): intentionally empty. Agent-preset DATA stays
  engine-native — the official `@deepseek-ai/dsh-agent-presets` host row and
  its `agentPreset.*` wire face. This entry only lets DSH discover the
  package's `dsh.client` declaration (the `dsh-plugin-ui-shell` precedent).
- **Client half** (`src/client/`): registers two `amiba.settings.section`
  entries — `behavior` (order 5, the 行为与人设 page: read-only default-preset
  description + SOUL) and `agents` (order 10, the roster + drill-in), so the
  Assistant group reads behavior → agents → Models & services (50). Both ids
  preserve the retired registry ids so `#behavior` and `#agents` deep links
  keep resolving through SettingsView's `dsh:<id>` ledger fallback.

## Data plane

The client consumes the engine-native wire face on the connection service —
`ctx.get("connection").api.agentPresets.{list,read,copy,openDocument,remove}`
plus `api.settings.update` on the `agent-presets` namespace for default-preset
writes — exactly the surface the official `dsh-client-ui-agent-preset` row
used before Amiba disabled it. Roster refreshes ride the forwarded
`settings/document-updated` host event (`ctx.remote.$on`). No host platform
adapter (`getPlatform()`) is involved.

Note: the `agentPreset.*` face is **not** a `ctx.remote` Typert namespace —
the api-remotes assembly mounts only `commands`, `dynamicCordisRunner`,
`goals`, `messageFeedback`, and `pluginInventory`. The connection service's
`IApiClient` is the official consumer surface for presets.

## Detail tabs

The detail's first tab (行为与人设) is native to this plugin; every other tab
comes from the `amiba.agentPreset.section` ledger. The reserved id
`behavior` is filtered — a ledger entry claiming it is ignored rather than
allowed to shadow the native tab. For a ledger tab the page renders the slot
marker (`data-amiba-dsh-slot` + `data-amiba-dsh-slot-only` +
`data-amiba-dsh-profile-id`); the ui-shell root's document-wide scanner
portals the owning plugin's contribution into it, exactly as it did when the
host settings page emitted the same marker.

## i18n

Plugin-local overlay dictionaries (`src/client/i18n.ts`, en/zh-CN parity
tested). The entire host `options.agents.*` family — including the
behavior-editor keys, whose host page moved here too — was purged from
`packages/i18n`; only shared vocabulary such as `common.*` stays host-side
(resolved through `usePluginT`'s host-catalog fallback).
