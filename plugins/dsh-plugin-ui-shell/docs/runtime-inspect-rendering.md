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

- No provider/platform/method selects a body renderer. All JSON values use the same structural renderer.
- Primitive fields have an explicit source key and aligned value; strings remain original, including multiline declarations. Null, false, zero, empty strings, arrays and objects stay distinguishable.
- Objects are labeled groups; arrays have numbered, separated entries. Nested groups mount lazily, and arrays/objects page after 20 entries. No depth/length truncation drops content.
- Access details, schemas, code and referenced types start collapsed. This only affects initial presentation, not whether data can be read.
- Hex color swatches appear only beside an actual hex string. Theme token metadata never invents a color.
- The exact JSON text remains available in a separate, initially collapsed disclosure.
- Known envelope metadata remains visible; unknown envelope extensions are retained too.

## Fixtures and limits

`src/dev/runtime-inspect-fixtures.json` contains 18 examples shared by the interactive preview and regression tests. Service/Event/Builtin/Theme names, descriptions and signatures are extracted from the installed catalogs. Lists are sampled; referenced-type closures are omitted in those abbreviated examples. Slots/Tool/self examples are synthetic values following the audited runtime return structures, not captured user sessions. The final unknown-provider example exercises extension fields and mixed/empty values.

The original demo's `openPanel`/`closePanel` methods and bare theme color list were illustrative and did not represent the installed query outputs. They have been replaced by the catalog/shape-based cases above.

Tests fully expand and paginate each fixture, verify every scalar is reachable outside the raw JSON, and preserve the exact JSON text. They also cover platform/provider independence, long strings, deep unknown fields, metadata extensions and malformed/plain-text output. These checks do not replace a live desktop end-to-end run.
