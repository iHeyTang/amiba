# @amiba/dsh-plugin-mcp-manager

Lifecycle manager for user-configured MCP servers. It mounts one official DSH MCP client plugin instance per enabled server, preserves unchanged fibers, rolls back failed replacements, and records MCP tool provenance in the Amiba catalog.

- Injects: `tools`, `webServer`, `amibaToolCatalog`
- Config: management `apiToken`
- Uses DSH's official MCP client plugin; it does not implement a second MCP tool runtime.
