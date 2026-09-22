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

The body chooses a presentation from the returned structure, not a provider name. Original field values are never translated or inferred.

- Identified record arrays (name/key/id/signature/pluginId/packageId) share up to three comparison columns. A row's remaining fields are accessible from its Details button. Method signatures stay beside their descriptions, and long text wraps without truncation.
- Named nodes with children use a tree: expand the node name directly. Node metadata is separate from topology; malformed descendants fall back to ordinary records.
- A runtime with host/client diagnostic objects presents state, status, errors and nonempty waiting lists before package metadata and source. Empty diagnostic collections stay reachable in Details.
- Other fields retain the aligned structural fallback. Empty arrays/objects are inline values rather than clickable empty groups.
- Search traverses the complete JSON, including envelope extensions, folded branches, schemas and unpaged records. Results show the matching record in context with an exact JSON property path. Clearing search restores browsing.
- Arrays, object fields and search results page after 20 entries; nested branches mount lazily. Every value remains reachable, and the original JSON is unchanged.
- Comparison tables can scroll horizontally on narrow screens, with a visible hint. The page itself must not overflow horizontally.

## Usability checks

At the same desktop preview width, the 13-token fixture previously occupied about 2106px and showed two complete items within the first 384px of content. The comparison table occupies about 721px and shows six complete records in that same height. This is a fixture layout measurement, not a user study.

Task checks cover finding record 45 without paging, finding a folded schema description with its exact path, comparing records under shared column headers, seeing an error before opening package/source details, and expanding tree nodes without children/index wrapper levels. Desktop Service/Theme/diagnostic views and the 375px table were visually checked. All 18 fixtures had no document-level horizontal overflow at 375px.

## Fixtures and limits

`src/dev/runtime-inspect-fixtures.json` contains 18 examples shared by the interactive preview and regression tests. Service/Event/Builtin/Theme names, descriptions and signatures are extracted from the installed catalogs. Lists are sampled; referenced-type closures are omitted in those abbreviated examples. Slots/Tool/self examples are synthetic values following the audited runtime return structures, not captured user sessions. The final unknown-provider example exercises extension fields and mixed/empty values.

The original demo's `openPanel`/`closePanel` methods and bare theme color list were illustrative and did not represent the installed query outputs. They have been replaced by the catalog/shape-based cases above.

Tests fully expand and paginate each fixture, verify every scalar is reachable outside the raw JSON, and preserve the exact JSON text. They also cover platform/provider independence, long strings, deep unknown fields, metadata extensions and malformed/plain-text output. These checks do not replace a live desktop end-to-end run.
