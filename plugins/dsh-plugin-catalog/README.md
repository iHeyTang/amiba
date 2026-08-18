# @amiba/dsh-plugin-catalog

DSH-side source-of-truth for model-visible tool provenance. Plugins register their own tool source metadata through `registerToolSource`; the authenticated `/api/amiba/tools` route reads the live DSH `ToolRuntime`, optionally scoped to an existing session.

- Injects: `tools`, `webServer`, `agents`
- Provides: `ctx.amibaToolCatalog`
- Config: per-process `apiToken`
- Owns no tool schema and never accepts a Desktop Host tool catalog.
