# @amiba/dsh-plugin-messaging-core

Provider-neutral DSH message hub. It owns channel-to-session routing, secret digests, sender policy, inbound deduplication, persisted recovery, Agent wake-up, reply correlation, durable outbox retries, and provider registration.

- Injects: `agents`, `agentPresets`, `sessionPersistence`
- Provides: `ctx.amibaMessageCenter`
- Config: durable `root`
- It is headless: no React dependency, Client entry, settings slot or management Remote.
- It contains no transport provider. Connector-core binds optional messaging capabilities to this service; platform adapters register through connector-core.
- It contains no HTTP route and has no WebServer dependency. Web transports own their routes.
- User-facing diagnostics are projected by connector-core into account details. Internal channel IDs and authentication secrets are not connection UI concepts.
