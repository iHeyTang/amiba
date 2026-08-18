# @amiba/dsh-plugin-messaging-channel-webhook

Webhook channel provider for `@amiba/dsh-plugin-messaging-core`. It registers provider id `webhook`, authenticated JSON ingress at `/api/amiba/message-inbound`, and optional JSON reply delivery.

- Injects: `amibaMessageCenter`, `webServer`
- Depends on: `@amiba/dsh-plugin-messaging-core`
- Remote callbacks require HTTPS; loopback HTTP is allowed for local integration.
- Provider and HTTP registrations unwind with the Cordis plugin lifecycle.
