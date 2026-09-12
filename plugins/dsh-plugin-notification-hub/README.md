# @amiba/dsh-plugin-notification-hub

Shared notification mechanisms for Amiba plugins. This package provides no notification UI. Each presentation plugin owns its own selection policy, wording, layout and interaction.

## Host service

`ctx.amibaNotifications` provides:

- `post({ title, body?, kind?, status?, sessionId?, source, key? })`: validates and stores a notification; a source-scoped key deduplicates retained records.
- `dismiss(id)`: records an explicit user dismissal.
- `markSessionsRead([{ sessionId, readAt }])`: advances read watermarks monotonically and marks matching notices as read.
- `resolve(source, key)` / `resolveNotification(id)`: records that the underlying request has ended, independently of reading or dismissing it.
- `renameSession(sessionId, title)`: updates conversation notice headlines.
- `list()`, `subscribe(listener)` and `registerSink(callback)`: local snapshot/change/post consumers.

With `root` configured, writes are atomically persisted before publication. Unread notifications and unresolved requests are retained; only settled history is capped at 100 records. A persistence failure does not publish an unsaved mutation. Invalid existing data is reported rather than silently replaced.

## Client transport

The package owns the `amibaNotifications` DSH Remote namespace and the `amibaNotificationFeed` client service. Neither depends on the pets plugin or an Electron notification bridge.

The feed first requests a snapshot, then waits for cursor-based changes through authenticated RPC. The transport uses event-driven long polling with a 20-second empty heartbeat, below DSH's unary timeout. It does not scan or resend the full list every second. Revision gaps and server restarts trigger a fresh snapshot; connection failures back off; unloading cancels the outstanding watch.

The feed exposes `getSnapshot`, `subscribe`, `dismiss` and `markSessionsRead`. Consumers may filter the data and render any UI. The built-in read observer consumes the shell's `amiba.session.observer` lifecycle slot; session reads work without any pet surface.

## Lifecycle

`readAt`, `dismissedAt` and `resolvedAt` are separate facts and may coexist. The helper `isNotificationVisible` expresses the default unread/pending filter; presentation plugins can use their own policy. An unresolved request remains protected from history trimming even if the user already read or dismissed its presentation. Business producers must resolve their requests when they end.
