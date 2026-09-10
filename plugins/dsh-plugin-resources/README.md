# Account-bound resources

A small DSH plugin providing `amibaResources`. Providers register search/read implementations with a lifecycle disposer. The host knows no platform APIs or credentials; the same service supplies human previews, official input-trigger references and read-only Agent tools.

References contain `source`, `connectionId`, `identity`, `kind`, and opaque `id`. These are locators, not authorization. Each access validates connection, identity and permissions. The registry enforces identity matching, bounded content, safe links and unload cancellation. Unavailable sources are distinct from empty results.

The client registers one official input-trigger source, projected onto draft and session composers through ui-shell, and mounts previews in `shell.overlay`. There is no synthetic session, private registry access, global resource index or alternate plugin loader.

Providers enforce Agent consent for `amiba_resource_search` and `amiba_resource_read`. Content is marked untrusted external data. Authentication, writes and richer workspace applications stay provider-owned.

Development: `pnpm --filter @amiba/dsh-plugin-resources test`, `typecheck`, or `build`.
