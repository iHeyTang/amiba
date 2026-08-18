# @amiba/dsh-plugin-messaging-core

Provider-neutral DSH message hub. It owns channel-to-session routing, secret digests, sender policy, inbound deduplication, persisted recovery, Agent wake-up, reply correlation, durable outbox retries, and provider registration.

- Injects: `agents`, `agentPresets`, `sessionPersistence`
- Provides: `ctx.amibaMessageCenter`
- Config: durable `root`
- It contains no transport provider. Each channel transport is a separate sibling project that depends on this service.
- It contains no HTTP route and has no WebServer dependency. Web transports own their routes.
