# Runtime inspection rendering coverage

Audited against installed DSH `0.1.5-rc.1` on 2026-09-22. This is a source-level inventory of built-in registrations, not a claim about which providers are currently running on a connected client. Plugins may register additional providers.

## Sources

- `@deepseek-ai/dsh-cordis-client-runner/lib/client.js`: `clientInspectProviders`, `queryServiceApi`, `queryEventApi`, `compactSlotTree`, `inspectLiveSlot`, and generated Service/Event catalogs.
- `@deepseek-ai/dsh-tool-cordis/lib/index.js`: `hostInspectProviders`, the three inspect tool execute/output functions, `selfSummary`, and `inspectSelfPackage`. Inspected in the existing prepared desktop runtime.
- `@deepseek-ai/dsh-cordis-host-runner/lib/index.js`: provider directory projection and `HOST_BUILTIN_INSPECTION`.
- `@deepseek-ai/dsh-client-ui-theme/lib/client.js`: `BUILTIN_INSPECT_TOKENS` and `exportInspectTokens`.
- `@deepseek-ai/dsh-tools/lib/index.js`: `schemas` / `schemaOf` for Tool output.

## Built-in shapes

| Platform | Provider / method | Returned data |
| --- | --- | --- |
| host, client | Service.listService | `mode: catalog, services[]` or `mode: service, service, referencedTypes[]`. Methods contain `signature`, description, parameters, optional returns/throws; no guaranteed `name`. |
| host, client | Event.listEvents | `mode: catalog, events[]` or `mode: event, event, referencedTypes[]`; event signatures, modes and parameters. |
| host, client | Builtin.listBuiltins | `builtins[]`, `referencedTypes[]`; names, descriptions and string signature arrays. |
| host | Tool.listTools | `tools[]`; names, descriptions and nested parameter schemas. |
| client | Theme.listTokens | `tokens[]`, `referencedTypes[]`; token name, description, valueType, requiresLightAndDark, cssVariable. This directory does **not** return computed color values. |
| client | Slots.listSubTree | `trees[]`, optional `requestedRoot` and `selected`, `referencedTypes[]`; recursive children, occupants and registration contracts. |
| inspect_list | provider directory | `providers[]`; each entry has platform, id, description and method input/output schemas. |
| inspect_self | plugin directory | `mode: plugins, plugins[]`. |
| inspect_self | one plugin | `mode: plugin`, version pointers and `packages[]`. |
| inspect_self | exact package | `mode: package`, plugin, packageId, name, purpose, code and host/client runtime diagnostics. |

Query responses wrap provider data with `platform`, `provider`, `method`, `data`. List/self responses do not have that wrapper. Registries permit additional JSON-safe outputs from third-party providers.

## Shared display rules

Results use [`@uiw/react-json-view`](https://github.com/uiwjs/react-json-view), pinned to `2.0.0-alpha.43` (the registry's current v2 release). It supports the project's React 18 peer dependency. The app wrapper only parses the output, configures the library and connects theme colors; it contains no recursive renderer.

- All platforms/providers use the same component with the complete result envelope.
- Library defaults handle object/array folding and copying JSON. Copy preserves the entire selected value even when descendants are folded.
- Type labels and object-size annotations are disabled. Long strings are not truncated. Field names, values and ordering are not translated or summarized.
- The viewer is read-only. Primitive JSON roots and invalid/plain-text output remain verbatim text. Pending calls retain compact arguments.
- Syntax colors and borders work in light/dark mode; overflow is contained within the result.

## Fixtures and limits

`src/dev/runtime-inspect-fixtures.json` contains 18 examples shared by the interactive preview and regression tests. Service/Event/Builtin/Theme names, descriptions and signatures are extracted from the installed catalogs. Lists are sampled; referenced-type closures are omitted in those abbreviated examples. Slots/Tool/self examples are synthetic values following the audited runtime return structures, not captured user sessions. The final unknown-provider example exercises extension fields and mixed/empty values.

The original demo's `openPanel`/`closePanel` methods and bare theme color list were illustrative and did not represent the installed query outputs. They have been replaced by the catalog/shape-based cases above.

Tests expand all 18 fixtures and verify scalar content remains reachable, and verify the library's copy output matches each complete fixture. Integration checks also cover folding, changed results, primitive roots, long strings and invalid output. These checks do not replace a live desktop end-to-end run.
