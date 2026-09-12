# @amiba/dsh-plugin-connector-dingtalk

DingTalk connector provider for the Amiba runtime. Translates Stream Mode robot messages into ConnectorInboundEnvelopes.

- Injects: `amibaConnectors` with provider id `dingtalk`
- Transport: DingTalk's official Stream Mode long connection (no public IP required)
- Event translation: pure functions with 100% test coverage (totality suite, all edge cases)

## Quick connection

The wizard defaults to QR authorization, with manual Client ID / Secret entry
available as a fallback. Scan in DingTalk, select an organization, and create or
bind a robot on DingTalk's authorization page. Developer permissions and any
organization approval are handled there. No extra CLI installation is required.

`registration.ts` implements the official connector's `init → begin → poll`
protocol at `https://oapi.dingtalk.com/app/registration`, using its documented-in-source
`DING_DWS_CLAW` registration source. Reference:
https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/5fef12d37377e299e26d18b0145baf646cd17a8b/src/device-auth.ts
and the adjacent `device-auth-config.ts`.

The host receives credentials directly and runs the same validation, storage and
Stream connection path as manual setup. Only the authorization QR and safe status
codes reach the renderer. Requests have a 15-second timeout; transient polling
failures retry up to three times. The flow expires within ten minutes. Closing the
wizard or choosing manual setup aborts local requests and polling; it does not
undo robot changes already confirmed on DingTalk's page.

Live `init` and `begin` were verified against DingTalk. Automated tests cover
success, terminal errors, expiry, cancellation, retries, credential isolation and
wizard lifecycle. Completing real authorization requires a user scan in their
organization; tests do not create robots or send messages to real contacts.

## Personal documents

The existing DingTalk connector settings now provide personal device authorization, document search and preview, and a separate model-access switch. Bot credentials do not authorize personal documents. Disconnecting personal access keeps the bot connection.

Uses the official [DWS CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) device OAuth and document MCP protocol. Only search_documents, get_document_info and get_document_content are exposed; current-user profile binds authorization to organization and user. Tokens remain in private connection state. References bind connection and identity, so account changes invalidate old references.

Search distinguishes missing source registration, missing or expired personal authorization, disabled model access and permission failures. Empty results do not imply reconnection. DingTalk enforces document permissions. Mock protocol tests do not replace end-to-end validation with an authorized account.
