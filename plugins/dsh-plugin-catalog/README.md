# @amiba/dsh-plugin-catalog

DSH-side source-of-truth for model-visible tool provenance. Plugins register their own tool source metadata through `registerToolSource`; the authenticated `/api/amiba/tools` route reads the live DSH `ToolRuntime`, optionally scoped to an existing session.

- Injects: `tools`, `webServer`, `agents`
- Provides: `ctx.amibaToolCatalog`
- Config: per-process `apiToken`
- Owns no tool schema and never accepts a Desktop Host tool catalog.

### MCP tool directory

The tool directory groups MCP tools by their exact `source.provider` server
identity, never by their display label. Managed connector names flow through the
MCP manager into provenance as `displayName`; unnamed services use a localized provider name or generic MCP service label.
Internal server IDs are grouping keys only and are not rendered in the list. The section counts services and tools separately, and each
service expands to its tools. Common Lark operations have localized labels;
other operations use a readable unqualified name. The exact registered call ID
remains available in tool details. This inventory counts services with registered
tools, not all configured MCP connections (including failed or empty services).


Tools are grouped by delivery (`builtin | user`), independently of provider,
transport or mount lifecycle. The patched DSH tool registry retains the owning
Context for each exact definition, including scoped shadows. The catalog compares
its Loader entry with the application-shipped bundle composition; user presets
and DSH's dynamic-code boundary identify user extensions. MCP connection ownership
supplies its explicit delivery type. Same-name registrations remain distinct;
inherited registrations are counted once. Missing registration context is an
internal invariant failure, never a third product category.
