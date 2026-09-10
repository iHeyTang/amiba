# @amiba/dsh-plugin-connector-core

Connect lifecycle mechanism for the Amiba runtime. A **connect** is one binding
between the user and one external platform application; once enabled it fans
out into optional capabilities: messaging (via messaging-core) and tool
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

## Ownership

The Client plugin owns the only Connections settings entry: connector
directory, provider detail shell and account management. Provider plugins
contribute their wizard, overview and optional account-settings component
through the UI registry. The application core contains none of this UI.

`ConnectorProvider.messaging` explicitly opts into messaging. Tool-only
providers omit it and require neither a channel nor a `deliver` method.
`ownerPairing` is for IM adapters that pair with their first sender;
authenticated transports enforce their own access policy instead.

`getConnectDetails` projects delivery status and conversation routing without
exposing internal channel IDs. `settings(config)` is an explicit public
projection, never a credential dump. `configure(config, patch)` is provider-owned
and its result is validated before committing. Account edits, enable/disable
and removal are serialized per account; failed updates restore the prior
configuration. Credentials stay in the credential store, not connect metadata.

Approval policy has one owner in the shared messaging/agent approval service;
there is no duplicate policy field or editor on each connection. The previous
standalone messaging management Remote and UI have been removed, not aliased.
