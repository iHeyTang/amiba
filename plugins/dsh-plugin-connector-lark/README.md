# @amiba/dsh-plugin-connector-lark

Lark/Feishu connector provider for the Amiba runtime. Translates `im.message.receive_v1` events into ConnectorInboundEnvelopes.

## Host half (`src/index.ts`)

- Injects: `amibaConnectors` with provider id `lark`
- Supports: Lark and Feishu (switchable via `domain` config)
- Event translation: pure functions with 100% test coverage (6 rules, all edge cases)

## Client half (`src/client/index.tsx`)

- Injects the `amibaConnectWizards` Cordis service that connector-core's client
  half provides, and registers the `"lark"` connect wizard on it.
- `LarkWizard` is the wizard body the Connect settings modal mounts for this
  provider: a scan/manual toggle over the scan-to-connect flow (QR code plus a
  1.5s `pollOnboarding` loop) and the manual App ID / App Secret / Domain form.
  It depends on nothing but the `host` prop it is handed, so the same body
  works wherever the wizard chrome is mounted.
- Copy lives in `src/client/i18n.ts` (zh-CN + en) and resolves through
  `usePluginT`, never through a host catalog.
