# @amiba/dsh-plugin-connector-webhook

Custom HTTP connector. Registers a `ConnectorProvider` and provider-owned
wizard, overview and account settings with connector-core. Multiple accounts
have independent request URLs, credentials, callbacks and sender allowlists.

- Injects `amibaConnectors` and `webServer`; never calls messaging-core directly.
- Enabled accounts register `POST /api/amiba/connectors/webhook/<connectId>`.
- Authenticate with `Authorization: Bearer <token>`. Credentials live only in
  the local credentials service; list/detail responses never return them.
- JSON body: `{ "id": "event-001", "text": "Hello", "sender": "my-service",
"conversation": "thread-001" }`. `sender` and `conversation` are optional;
  the conversation key defaults to the sender, then `default`.
- Connector-core routes to the shared messaging service for per-account
  deduplication, session creation, approval relay, recovery and queued replies.
- An optional reply URL receives `{ id, connectId, conversation, inReplyTo,
text, createdAt }`. HTTPS is required except for loopback HTTP; redirects
  are rejected and delivery has a 20-second timeout.
- UI uses `@amiba/ui` primitives. Request examples and credentials belong to
  this plugin, not the common connection page or application core.

Disabling/removing an account unregisters its route. Rotating a credential
restarts that account only. Invalid edits are rejected before stopping it;
failed restarts roll back to the previous configuration. There is no legacy
message-channel endpoint, settings page or compatibility alias.
