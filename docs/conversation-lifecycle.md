# Plugin-owned conversations

## Intended behavior

The steward, Lark and DingTalk have stable chat entries with multiple dated
sessions. Default rotation is daily in an explicitly persisted time zone;
weekly (Monday boundary) and manual rotation are supported. Only an incoming
message advances a segment. Rotation must not archive/cancel previous work or
lose the route for a late reply/approval. Plugin-owned task sessions have their
own lifetime and do not rotate with the steward's conversational entry.

A group member can address the bot without entering platform user IDs. Being
allowed to talk is separate from authority to use the owner's private account,
read private history, or approve operations. Those capabilities must be enforced
at execution/resume time, including indirect tools and subagents, before the
existing owner-only ingress gate is relaxed. A group may use explicitly shared
resources; membership alone must not grant the owner's personal connectors.

Normal settings show connection health, who can use the assistant, conversation
cadence/history and actionable delivery errors. Queue counts and raw chat/session
IDs belong in diagnostics. Lark and DingTalk retain their own provider UIs.

## Implemented foundation

`dsh-plugin-session-features` publishes `amibaConversations` from its configured
root. `ConversationLifecycle` persists entry ownership (plugin + entry + scope),
policy, current segment and previous segments using serialized atomic writes.
Malformed ownership fails closed. Adoption migrates known legacy bindings once
without transferring a session between privacy scopes. Calendar-based period
calculation handles time zones and DST.

`conversation_search_history` derives its scope from the calling agent's stored
session identity, never from model-supplied account/chat IDs. It returns bounded
user/assistant excerpts from previous segments, excludes archived sessions and
tool results, and reports truncation. Each call scans up to 200 prior sessions and returns `nextCursor` when more
history remains. The agent can continue through older pages in the same scope.

Messaging-core uses this registry for per-conversation routing. Superseded
bindings remain persisted for outbound delivery and pending approvals, while
normal conversation listings return only the current binding. Approval answers
resolve against pending questions in the same stable chat before advancing the
current segment. A bare answer matching multiple segments is rejected as
ambiguous.

The steward now declares its main entry in this registry, migrates its existing
session, and advances on prepare-submit. Page opens/polling and task reports do
not themselves advance it. Previous agents drain before disposal; independent
task sessions remain unchanged. Prior steward segments cannot be adopted as
ordinary tasks and remain owned/hidden with the current steward entry.

The shell provides a prepare-submit remote backed by registered plugin handlers.
The renderer resolves the destination before optimistic messages are appended,
waits for the destination render (with its own history), and preserves text and
attachments. Failed/unloaded handlers fail visibly instead of falling back to an
unmanaged session. Switching tabs while preparation is pending cancels the send.
Messaging startup migrates current and superseded routes without creating new
sessions.

## Completion audit

| Requirement | Implementation and verification |
| --- | --- |
| Group members can address the assistant without user-ID setup | Lark/DingTalk declare shared conversations; connector and messaging tests cover owner pairing, member admission and owner-only approvals. Ordinary shared-connector settings omit the ID input. |
| Membership does not grant private account access | Shared markers survive resume/fork. Real ToolRuntime/SystemPrompt tests verify the allowlist, private-context suppression and denial of late scoped/private tools. |
| Explicit resource sharing and revocation | Both provider-owned pickers use account-bound search and explicit save. Core sharing tests verify owner reads, failure-before-commit and offline revocation; messaging/resource tests verify chat scope and revoke-during-read. Electron previews verify rendering and explicit revoke actions. |
| Everyday settings avoid internal counters and mappings | Current-chat choices use titles/friendly fallbacks; dated history opens sessions. Raw mappings/counters remain under closed diagnostics. Account-page tests verify placement and no allowlist input. |
| Useful delivery failures | Failure notice and owner-triggered retry reuse the original envelope without rerunning the agent. Tests cover current-account scope, duplicate prevention, renewed failure and exclusion of archived/approval envelopes. |
| Daily, weekly and manual conversation lifecycle | Shared durable service, timezone-preserving settings, Monday boundaries, first-message creation and no empty sessions. Calendar, restart, migration and concurrent-resolution tests pass. |
| All three plugins own their entries | Steward main entry and each IM chat resolve through registered plugin submit handlers. Persistence prevents cross-plugin/account/chat ownership transfer; missing owner handlers fail closed. |
| Keep history and ongoing work | Old routes and approvals remain valid across rollover. Steward waits for prior work to drain; independent task sessions do not rotate. Tests cover delayed approvals, duplicate inbound, archived/missing sessions and task preservation. |
| Search earlier conversations | Caller-derived scope; user/assistant text only, archived sessions excluded. Pagination reaches beyond 200 segments and bounds even all-archived pages. History tests cover isolation and older-page retrieval. |
| Desktop send uses the new segment | UI handoff tests preserve text/attachments and destination history, and cancel on navigation/unmount. The real desktop smoke invokes concurrent prepare-submit requests and verifies exactly one new segment with retained history. |

## Shared conversation access

Lark and DingTalk declare `sharedConversations`. After private owner pairing,
non-owner senders can use the assistant; a group can never claim initial ownership.
Owner private chats retain personal access. All groups and non-owner private
chats use a fresh shared session boundary, leaving legacy owner history separate.
Text and native approval paths consult a distinct, freshly evaluated owner check.

`amiba/shared-conversation` is a persisted event. Unlike role ownership its privacy
boundary survives forks. Session Features installs a native-tool presentation,
monotonic execution guard, restricted visible tool set, complete shared persona,
and suppression of private dynamic runtime context. Only scoped history and
explicit shared-resource reads/search are allowed. Code execution, local files,
personal MCP tools and delegated agents cannot bypass this boundary, including
late scope-local tools. Missing shared identity denies execution.

Resource tools detect the caller's persisted shared boundary. Searches read only
explicitly granted references (never account-wide search); direct reads check the
same grants. Results are rechecked after I/O and discarded after sharing is revoked.
The normal provider token/account/model-access checks still apply.

Real ToolRuntime/SystemPrompt tests cover blocked private and late scoped tools,
allowed scoped history, removal of private system/runtime context, and inherited
fork restrictions. Messaging and connector tests cover fresh shared segments,
isolated old history, private pairing, member ingress, and owner-only approvals.
Resource tests cover cross-group/unshared references and revocation during a read.

## Conversation settings UI

The steward navigation now includes a dialog for daily/weekly/manual cadence,
next-message rollover and dated history. Lark and DingTalk each own a separate
settings component with a named chat selector and the same lifecycle choices.
The connector host passes only its own account-bound management interface.
Messaging derives origin from the stored route and verifies persisted membership
before reading or changing settings; arbitrary plugin/scope IDs are not accepted.
Settings reads never create a session or file, cadence edits preserve the saved
time zone, and pending rollovers are visible before the next message arrives.

Shared connectors no longer show the owner ID input. Raw routes and delivery
counters remain inside a closed diagnostics section; delivery failures also have
a plain-language notice and an explicit retry action. Retry is account-bound,
serializes with the delivery pump, keeps original envelopes/IDs, and never reruns
the agent. Approval envelopes and archived sessions are excluded. Renewed failures
remain visible; a no-eligible-reply result explains why nothing was resent. Tests
cover account boundaries, concurrent retries, exclusions and renewed failures.
Both platform-owned resource pickers now search only the selected connection,
let the owner explicitly save selected references and revoke existing grants.
New grants are checked through owner preview reads and canonical account-bound
references; prior grants can be retained/revoked when a platform is offline.
The connector serializes saves with other account mutations, and messaging
verifies the stored shared origin before persisting. Tests cover explicit saves,
read failures, account/chat boundaries and offline revocation.
UI tests cover cadence and new requests, dated history navigation, failures/retry,
and stale responses when switching chats. Steward tests use the real dialog/button
primitives. Backend tests cover empty settings reads, saved-zone preservation,
scope checks and first-message rollover after a manual request.

Electron component previews rendered all three conversation controls and verified
explicit resource revocation for both IM platforms. Screenshots are under
`/tmp/amiba-{lark,dingtalk,steward}-conversation-settings.png`; this uses mock
account services and does not substitute for an integrated application smoke.
The preview exposed English date formatting in an otherwise Chinese UI; all
three controls now format dates using the plugin's active language.

The first real application smoke found duplicate shell Remote package registration.
The shell now mounts Markdown and conversation namespaces in one contribution.
A subsequent full runtime prepare/verify and real desktop conversation smoke
passed. The broader browser-only smoke hit an unrelated stale input selector;
conversation checks are now maintained independently in
`apps/desktop/scripts/smoke-conversation-lifecycle.mjs`.

Verification commands:
- Run the affected session-features, messaging-core, connector-core, Lark,
  DingTalk, resources, steward and ui-shell test/typecheck scripts.
- Run UI `conversation-submit-handoff.test.tsx`, `ChatSurfaceMode.test.ts` and
  UI typecheck.
- Run `pnpm runtime:prepare`, `pnpm runtime:verify`, then
  `node apps/desktop/scripts/smoke-conversation-lifecycle.mjs`.

The desktop smoke uses an isolated profile without model/IM requests. It verifies
real plugin loading, persisted manual cadence, deferred rollover, and concurrent
prepare-submit creating exactly one next segment while preserving the prior one.
Its screenshot is `/tmp/amiba-live-steward-settings.png`.

## Verified result — 2026-09-12

Final runtime prepare and verify passed, including the history pagination and
localized preparation errors. The maintained real desktop smoke exited 0 and
verified manual cadence persistence, deferred creation and exactly one next
segment under concurrent prepare-submit, with old history retained.

Evidence:
- `/tmp/conversation-final-all-tests.log`: all eight affected plugin suites pass;
  `/tmp/conversation-final-all-types.log`: their typechecks pass.
- The final Session Features suite has 23 passing tests, including older-page
  history retrieval. Across the affected plugin suites and the 10 UI handoff/mode
  checks, 872 tests pass.
- `/tmp/conversation-final-handoff-tests.log`,
  `/tmp/conversation-final-chatmode-tests.log`,
  `/tmp/conversation-final-ui-types.log`: renderer checks pass.
- `/tmp/conversation-release-runtime-prepare.log`,
  `/tmp/conversation-release-runtime-verify.log`: final runtime passes.
- `/tmp/conversation-release-desktop-smoke.log`: final real application passes.
- `node --check apps/desktop/scripts/smoke-conversation-lifecycle.mjs` and
  the scoped `git diff --check` pass.

The smoke bounds debugger/RPC waits. A background macOS compositor may decline
an optional screenshot; this does not skip any functional assertions. Visual QA
was also performed using the rendered component previews and a real desktop
settings screenshot. Tests use isolated profiles and mock IM/resource providers;
no messages were sent to a real group and no personal sharing grants were changed.

## 设置入口

大管家通过插件注册独立的「设置 → 大管家」页面，集中管理对话周期、手动开启新对话和历史回看。主侧栏的大管家入口只负责进入对话，不再放置配置弹窗按钮。
