# @amiba/dsh-plugin-agent-preset

DSH plugin owning Amiba's agent-preset management UI: the ONE 智能体预设
("Agent presets") settings section — a roster led by a pinned row for the
current default preset (its read-only drill-in is the former 行为与人设 page),
the independent presets below with create/rename/delete/set-default, and the
`amiba.agentPreset.section` tab strip other plugins contribute detail tabs
into.

## Shape

- **Host half** (`src/index.ts`): intentionally empty. Agent-preset DATA stays
  engine-native — the official `@deepseek-ai/dsh-agent-presets` host row and
  its `agentPreset.*` wire face. This entry only lets DSH discover the
  package's `dsh.client` declaration (the `dsh-plugin-ui-shell` precedent).
- **Client half** (`src/client/`): registers ONE `amiba.settings.section`
  entry — `agents` (order 5, leading the Assistant group ahead of Models &
  services at 50). The id preserves the retired registry id so `#agents` deep
  links keep resolving through SettingsView's `dsh:<id>` ledger fallback. The
  former sibling `behavior` section merged into this page (its content is the
  pinned default row's drill-in); an old `#behavior` link still takes the same
  generic fallback and simply finds no section claiming the id.

## Roster

The list's first row is always the wire roster's current default preset (the
`isDefault` entry `agentPreset.list` reports — the shipped `standard` preset
unless the user defaulted a copy), pinned with a 默认/Default badge. Its
drill-in is the merged 行为与人设 content: the same detail layout, behavior
tab read-only (`sourceEditable` off), ledger tabs scoped to the default's
preset id, and no rename/delete/set-default — the default slot is managed,
not edited. A preset holding the default slot appears only as the pinned row
(one preset, one row); every other user-authored preset lists below it with
full CRUD, and the empty state below the pinned row speaks only about those
independent presets.

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
behavior-editor keys, which still render inside the drill-in's behavior tab —
was purged from `packages/i18n`; only shared vocabulary such as `common.*`
stays host-side (resolved through `usePluginT`'s host-catalog fallback).
