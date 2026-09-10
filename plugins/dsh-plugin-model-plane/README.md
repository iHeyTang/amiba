# @amiba/dsh-plugin-model-plane

Amiba's UI implementation for the **native DSH provider APIs**. Provider plugins
register with DSH unchanged. There is no Amiba provider registration contract,
provider registry, adapter façade, or `amibaModelPlane` RPC.

The browser uses the official connection directly:

- `llm.providers` and `llm.models`: configuration directory and model catalog.
- `settings.describe/mutate`: plugin-owned schemas, values and revisioned edits.
- `credentials.describe/set/unset`: value-free key status and write-only key entry.
- `sessions.models/selectModel`: current session selection.
- Official `agent-default-model` settings: selection for new sessions.

`NativeProviderSettings` is a private React data/action helper. `view-types.ts`
contains list-row and form state, retaining the official provider declaration.
Neither is a transport contract or an interface that provider plugins implement.
Official model, reasoning and selection types are reused directly. Events from
DSH invalidate the views; plugins are never copied into a second registry.

Amiba retains its own settings layout, schema form and model picker. A plugin that
provides models but no configurable declaration still works in the picker. Standard
configurable-provider declarations render automatically using their settings schema.
Interactive OAuth or a specialized schema UI may need a separate UI contribution.

## Optional enhancements (ABC + D)

The official ABC contract remains sufficient. Amiba enhancements are optional and
must not modify that contract or become prerequisites for ordinary community plugins.
Current provider/model visibility controls use the UI-owned `amiba-model-ui` namespace
through the standard settings API. They only filter Amiba menus; official models and
other clients are unaffected. Providers need no knowledge of these preferences.
A future plugin-owned D capability must have a separate opt-in declaration; its
absence disables only D and never the ordinary official path. No speculative D
provider protocol is introduced here.

The host entry registers only UI preferences and runs a one-time upgrade from the
old registry. Existing official settings are preserved; missing legacy settings and
visibility choices are migrated. The old file remains for recovery. `src/plane` and
`src/plane-dsh` contain historical decoding/conversion helpers used by that migration,
not an active provider layer. The old provider service, drivers, discovery and
projection implementations have been removed.
