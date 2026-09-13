# 微信 ClawBot connector

Independent Amiba plugin: `@amiba/dsh-plugin-connector-weixin`.
Connects a personal Weixin ClawBot conversation to Amiba through iLink. No OpenClaw process or installation is required: Amiba implements the transport directly. The official reference client is Tencent's [`openclaw-weixin`](https://github.com/Tencent/openclaw-weixin); protocol metadata currently follows its 2.4.8 wire format, while this plugin has its own version.

## Use

1. Build/start this checkout with `pnpm dev:desktop` (restart after adding the new package).
2. In Settings → Connect, choose **微信 / Weixin**, select an agent preset and scan the QR with Weixin. Confirm on your phone; if Weixin requests an extra verification code, enter it in the same wizard.
3. Send the first message in the Weixin ClawBot conversation. Only the scanning account can become its owner. Amiba must keep running to receive and reply.
4. Send text, an article URL, image, voice message or file. The assistant can inspect received images with `weixin_view_image`, use its available file tools for documents, and send requested output using `weixin_send_file`.
5. Disable/delete the connection in Settings to stop it. To replace expired credentials, remove the old connection and scan again. Closing an unfinished wizard cancels its requests, including a pending verification challenge.

The core product bundle composes this package separately alongside the Lark and DingTalk providers. It registers a host provider and a client-owned wizard; removing this plugin removes its platform behavior. The only connector-core addition is a generic, transient onboarding-input mechanism (with cancellation cleanup), usable by any provider.

## Implemented scope

| Capability | Behavior |
| --- | --- |
| Authorization | QR scan, status polling, trusted Weixin redirects, verification challenge, expiration refresh and cancellation |
| Messages | Personal text input and replies; long replies split without breaking Unicode characters |
| Files/media | Receive images, files, video and original voice bytes; send images, video and files through encrypted CDN upload |
| Voice | Use the transcript when Weixin includes it; otherwise convert supported SILK voice to WAV for an available transcription tool, retaining the original bytes if decoding is unavailable. Outbound audio is a file, not a native voice bubble |
| Images | Session-bound image tool returns native model image content |
| Quotes | Embedded reference content and a bounded local cache for server-ID-only references; unavailable original content is identified explicitly |
| Delayed replies | Persist conversation context/cursor across restarts; existing Amiba messaging/session/outbox and scheduling mechanisms deliver text replies to the bound conversation |
| Reliability | Abortable long polling, reconnect backoff, persistent inbound dedup and per-chunk outbound receipts; authorization error `-14` stops polling and clears sending context |
| Status | Connecting/ready/degraded/error in the shared connection UI; best-effort Weixin typing indicators and native tool start/result progress (names and status only) |
| Multiple accounts | Separate connection runtime, private state, download directory and session routing per connection/account |

The plugin does not expose contacts, personal favorites, other chats, Moments, payment APIs or group chat. Receiving an article URL does not bypass access restrictions on the article. Native speech generation is supplied by separate agent tools; text results use Amiba's completed-turn delivery.

`weixin_send_file` is scoped to the current live Weixin-origin session and its owner. It does not accept an arbitrary recipient or account. Desktop-origin sessions must deliver through the correct bound Weixin conversation. A context token is required; no assumption is made about indefinite server validity, proactive-send quotas or server dedup guarantees after an uncertain network response.

## Storage and transport

- Bot credentials are owned by connector-core's credential store; public connection details never return them. Verification codes are transient and are not saved to account settings.
- The plugin `root` is configured by the product bundle as `dshHomePath('amiba-weixin')`. Cursor, context token and recent receipt/quote records are saved in an account-specific directory with private file permissions. Context tokens never enter model-visible metadata.
- Media downloads are saved under that same account's private `media` directory with hashed message IDs and sanitized names. The download cache is pruned on incoming downloads to seven days / 256 MiB per account; old quote references can therefore outlive their attachment. Both encrypted and plaintext download sizes are bounded. The current local file-transfer limit is **50 MiB**, not a guarantee of the server's quota.
- All transport destinations must be HTTPS under `weixin.qq.com`, with no credentials in URLs or custom ports; HTTP redirects are rejected. Bot authorization is never attached to CDN fetches.
- QR binding uses the official service. This repository's automated tests use simulated service responses and do not authorize a real Weixin account or send personal messages.

## Verification

```sh
pnpm install --ignore-scripts
pnpm --filter @amiba/dsh-plugin-connector-weixin... build
pnpm --filter @amiba/dsh-plugin-connector-weixin typecheck
pnpm --filter @amiba/dsh-plugin-connector-weixin test
pnpm --filter @amiba/dsh-plugin-connector-core test
node scripts/verify-dsh-architecture.mjs
node scripts/verify-pluginization.mjs
```

Tests cover wire authentication and uint64 IDs, URL boundaries, encryption/upload/download, owner filtering, replay/restart recovery, quote restoration, partial-reply retry, cancellation and expiry, QR verification, wizard lifecycle, and the real connector → message center → agent followup → durable outbox → iLink delivery path with simulated network/agent endpoints. Before production rollout, scan with a real account and verify text, an image/document round trip, a voice message, delayed reply, disable/re-enable and authorization renewal.
