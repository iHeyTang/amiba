# @amiba/dsh-plugin-notification-hub

Provider-neutral desktop notification infrastructure for the Amiba runtime. The hub is a mechanism: posting plugins own notification content, delivery plugins own the transport to an actual surface (the Electron heads-up notifier via `dsh-plugin-runtime-gateway`, or nothing at all on headless runtimes).

- Provides: `ctx.amibaNotifications`
- `post({ title, body?, kind?, sessionId?, source })` → `{ id }` — zod-validated, bounded fields; `source` is the posting plugin's name.
- `registerSink(sink)` → disposer — provider-registry pattern; delivery surfaces wrap the registration in `ctx.effect()` so it unwinds with their fiber.
- `list()` — snapshot of the last 100 accepted notifications (in-memory only; no persistence in v1).

Lives in the Core bundle so every runtime can post; when no sink is registered, posts simply accumulate in the bounded ring.
