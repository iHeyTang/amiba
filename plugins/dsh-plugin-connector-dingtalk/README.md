# @amiba/dsh-plugin-connector-dingtalk

DingTalk connector provider for the Amiba runtime. Translates Stream Mode robot messages into ConnectorInboundEnvelopes.

- Injects: `amibaConnectors` with provider id `dingtalk`
- Transport: DingTalk's official Stream Mode long connection (no public IP required)
- Event translation: pure functions with 100% test coverage (totality suite, all edge cases)
