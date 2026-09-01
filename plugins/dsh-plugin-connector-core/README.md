# @amiba/dsh-plugin-connector-core

Connect lifecycle mechanism for the Amiba runtime. A **connect** is one binding
between the user and one external platform application; once enabled it fans
out into capabilities: a conversation channel (via messaging-core) and tool
capabilities (via capability appliers, e.g. mcp-manager).

- Injects: `amibaMessageCenter`, `credentials`; optional: `amibaMcpManager`
- Provides: `ctx.amibaConnectors`
- Config: durable `root`
- Contains no platform knowledge. Platform adapters register a
  `ConnectorProvider` and see only their handle — never messaging-core or
  mcp-manager directly.
- Credentials (platform config + channel secret) live only in the DSH
  credentials seam under `amiba-connector-core/<connectId>`, never in the
  JSON store.
