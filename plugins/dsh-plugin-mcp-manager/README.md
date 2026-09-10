# @amiba/dsh-plugin-mcp-manager

Lifecycle manager for user-configured MCP servers. It mounts one official DSH MCP client plugin instance per enabled server, preserves unchanged fibers, rolls back failed replacements, and records MCP tool provenance in the Amiba catalog.

- Injects: `tools`, `amibaToolCatalog`; optional `webServer` for the HTTP management face
- Config: persistent `root` and optional management `apiToken`
- Uses DSH's official MCP client plugin; it does not implement a second MCP tool runtime.

## Plugin dependencies

Providers use `provideMcpConnection`; consuming plugins use `useMcpRequirement` to declare readable capabilities and receive a scoped lease after explicit product approval. `manager.dependencies` remains the lower-level registration and leasing API. See [the contract](../../docs/mcp-dependencies.md). Sharing is opt-in on both sides and restricted to one connection and exact version. Grants remain independent; connection configuration stays with its provider. Settings show account selection, capabilities, consumers, retained approvals, and retryable feature failures without exposing runtime sharing controls.
