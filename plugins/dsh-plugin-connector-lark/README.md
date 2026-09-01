# @amiba/dsh-plugin-connector-lark

Lark/Feishu connector provider for the Amiba runtime. Translates `im.message.receive_v1` events into ConnectorInboundEnvelopes.

- Injects: `amibaConnectors` with provider id `lark`
- Supports: Lark and Feishu (switchable via `domain` config)
- Event translation: pure functions with 100% test coverage (6 rules, all edge cases)
