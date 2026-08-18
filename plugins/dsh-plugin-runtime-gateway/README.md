# @amiba/dsh-plugin-runtime-gateway

Authenticated execution transport from a DSH plugin to Amiba platform operations that must run in the desktop process. Tool schemas and registrations remain owned by the calling `dsh-plugin-*`; this package only transports calls, results, attachments, and cancellation.

- Provides: `ctx.amibaRuntimeGateway`
- Config: loopback `url` and per-process `token`
- Does not discover or project Host tools into DSH.
- When `ctx.amibaNotifications` (the Core notification hub) is present, registers the desktop delivery sink that forwards posted notifications to Electron main's `amiba_notify` native operation (guarded injection — plain transport still works without the hub).
