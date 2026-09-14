# Desktop message mirroring to IM

A desktop conversation already bound to an IM chat can opt in to mirror new
user messages and completed assistant turns to that chat. Lark, DingTalk and
Weixin all use the same messaging-core projection and durable outbox. Platform
messages are sent by the bot and labelled with their original author and desktop
origin. They are presentation copies: the original session log remains the input
to the agent, with no additional followup or altered role.

## User behavior

The connector account page and the bound session header expose the destination,
an opt-in checkbox, recent per-message delivery records, and retry. Existing
conversations default to off. Enabling snapshots the current event positions and
never backfills old inputs. Settings belong to account/chat/privacy scope and
survive daily/weekly/manual segment rotation. Disabling cancels queued mirrors;
an already in-flight platform request can still finish. New unrelated desktop
sessions and other platforms are not linked automatically.

Only text and completed assistant output are mirrored. File attachment envelopes
are replaced by names and a desktop-view notice; local attachment identifiers are
not copied. Tool output, private injected context, reasoning and intermediate
stream chunks are excluded. A completed turn without text gets a desktop-view
notice. Approval delivery continues on its existing independent path.

## Public-layer implementation

`desktop-sync.ts` projects durable events into envelopes with source message ID,
author, source surface, turn, stable scope, and enable-time generation. A stable
hash identifies each source/target/type combination. The persisted ledger records
queued, sent and cancelled deliveries; the outbox holds failures and retry state.
Replaying a log after restart fills missing deliveries without waking an agent.
The current implementation scans bound logs during recovery; it uses the ledger
for idempotency rather than a separate compaction-sensitive event cursor.

IM replies to a mixed desktop/IM turn share the assistant mirror's envelope, so
both ingress paths do not post the same final reply. Deliveries are ordered within
the stable chat scope, across segment changes; approval envelopes bypass a blocked
chat queue. Newly received authorized IM messages wake deliveries waiting for that
chat's reply credentials. Disabled channels cannot send. Archived sessions retain
the existing delivery prohibition.

Sending records an unconfirmed state before network I/O. Success settles the
ledger. A missing conversation transport schedules recovery; other uncertain sync
failures require explicit retry, with a duplicate warning. A restart after remote
acceptance but before local acknowledgement therefore cannot silently resend.
This is not a claim of universal exactly-once network delivery.

## Transport behavior

- Lark mirrors use literal text and a stable request UUID, without card-to-text
  fallback. Bot/app-origin incoming events are filtered, including the bot's own
  open ID. Ordinary IM replies keep their existing card rendering.
- DingTalk uses the currently cached session webhook. Missing/expired webhooks
  wait for a fresh incoming message; no new proactive-send API is introduced.
- Weixin uses the bound owner's context token and existing stable chunk IDs and
  durable sent receipts. Non-owner/group/bot messages remain excluded. Only the
  configured owner private conversation is supported by this connector.

These platform constraints remain visible. There is no promise of unrestricted
proactive delivery after a long period of IM inactivity, and “sent” means accepted
by the platform rather than read by a person.

## Verification

Tests cover opt-in without backfill, author/context separation, attachment
redaction, destination/privacy isolation, mixed-input deduplication, transport
ordering, persistent receipts, cancellation, rotation, cold-log recovery without
agent wakeup, and each provider's mirror delivery contract. UI tests cover target,
opt-in, uncertain delivery copy and scoped retry. Run build/typecheck/test for
messaging-core, connector-core and the three connector packages. Live-account
network delivery is not exercised by this automated suite.
