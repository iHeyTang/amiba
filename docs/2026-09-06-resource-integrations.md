# Account-bound resource integrations

## Ownership

- The application runtime owns plugin loading, dependency injection and lifecycle only.
- `connector-core` owns account lifecycle and a provider-scoped, server-only account access seam. Private account state stays in its credential record, never in renderer projections.
- `resources` owns a small source registry, stable references, bounded search/read, a generic resource preview host and the bridge to the existing input-trigger service. It knows no platform names or credentials.
- The Lark plugin owns device authorization, token renewal, contact/document APIs, resource registrations and preview data. Its tools and UI share the same service. Resource integration is optional and must not gate its existing bot functionality.
- `ui-shell` continues to own generic composer and workspace mounting. A plugin source must work in both draft and materialized-session composers.

## First delivery

1. Add resource protocol/registry and regression tests for identity routing, cancellation, disposal, partial search failures and bounded results.
2. Add provider-scoped account access and private state, without a renderer credential API.
3. Add Lark personal device authorization and read-only contacts/documents through the same account-bound service; preserve bot identity and existing connections.
4. Mount resource mentions and provider previews; do not introduce another mention protocol. Selecting a reference does not eagerly read its body or grant model access to every related object.
5. Add resource search/read tools, explicit human-to-agent handoff and source links. Keep write operations outside the read-only resource protocol.
6. Verify unit/type/architecture checks and isolated UI/runtime flows without authorizing a real account or reading private Lark data.

## Contracts

A reference identifies a source, connection, authenticated identity, kind and opaque platform object id. It carries no credentials and is not itself authorization. Every search/read rechecks connection and granted capability. Unloading or disabling cancels outstanding requests; historical references remain identifiable but unavailable. Search reports unavailable sources separately from empty matches. Model-readable content is bounded, explicitly marked external/untrusted, and retains its source reference.

The initial resource plugin is not a sync engine, global index, entity graph or a generic execution registry. Rich applications such as a mailbox reader register ordinary workspace views and may reuse resource references.

## Implemented boundaries

- Lark application/bot access remains independent of personal user authorization. Device authorization and refresh tokens use the existing connection's private credential record, never a machine-global CLI login or renderer storage.
- Personal Agent access defaults off. Human preview is independent; selecting/serializing a mention verifies Agent permission and only emits a stable citation, not an eagerly fetched document body.
- This first source supports people and modern `docx` documents. Sheets, legacy docs, wiki-node resolution, attachments, chat-history aggregation and service-specific write actions are not represented as supported previews.
- Search is query-driven, debounced and bounded. There is no background account crawl or private-data synchronization. Resource reads are capped at 40,000 characters and responses at 2 MB.
- Plugin account access is a server-side ownership convention for trusted DSH plugins, not a sandbox for malicious plugin code. Renderer remotes expose only explicit public projections.
- Remote payloads must omit absent optional properties: explicit `undefined` is rejected by the DSH JSON boundary. Runtime method argument names must match the declared descriptor.

Official API references used: [Lark CLI device flow](https://github.com/larksuite/cli/blob/main/internal/auth/device_flow.go), [contact search](https://github.com/larksuite/cli/blob/main/shortcuts/contact/contact_search_user.go), [document search](https://github.com/larksuite/cli/blob/main/shortcuts/doc/docs_search.go), [document raw content](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/raw_content).

## Validation

Unit and component tests cover identity/account separation, scope and Agent-consent enforcement, refresh deduplication, cancellation, source removal, external text rendering, JSON-safe projections, home-draft and session codec serialization. The focused `account-bound resource` runtime smoke boots an isolated DSH profile and verifies the real routes, including rejection by the account guard rather than by a mismatched wire signature. Desktop UI verification checks the existing account's unauthenticated personal-resource section without starting authorization or reading personal Lark data.
