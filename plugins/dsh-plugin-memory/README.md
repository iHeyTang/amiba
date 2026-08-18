# @amiba/dsh-plugin-memory

Preset-scoped durable long-term memory for DSH. It contributes bounded safe memory context and the `memory_list`, `memory_store`, and `memory_forget` tools. Entries flagged as instructions, secrets, or unsafe content remain reviewable but are excluded from model context.

- Injects: `tools`, `systemPrompt`, `webServer`, `amibaToolCatalog`
- Config: storage root, management `apiToken`, and memory/user/entry character limits
- Persistence key: DSH agent preset, not Desktop conversation UI state
- Audit: mutations append `amiba-memory/change` session events.
- Settings administration uses the plugin-owned `/api/amiba/memory` route; Electron never imports the store implementation.
