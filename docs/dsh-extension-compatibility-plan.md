# DSH extension compatibility implementation

Base: `main` at `3cbcaaa2dbf4b9036c43c5e0a175bcdcccaefecb`.
Initial branch: `feat/dsh-extension-compat-isolated` (merged).
Continued from main `99e8f93` on `feat/dsh-extension-compat-next` in the same isolated worktree.
Main and the other task's personal menu, external-message and update changes are preserved.

## Required invariants

- Preserve all existing Amiba capabilities, behavior, styling and default layout.
- An unoccupied additive extension contributes no DOM, spacing or placeholder.
- Use the official slot/service contracts, including actual owner data and disposal.
- Keep one authority for submission, session mutation and attachment ownership.
- Never claim compatibility using empty owner objects or no-op callbacks.
- Scope compatibility by DSH version; latest-only contracts need explicit bridges,
  not installation of another conflicting client runtime.

The user has specified the design: retain the existing Amiba workspace, settings,
conversation, tool and resource surfaces. Reuse its background/foreground, muted,
border, primary and semantic status tokens. No palette, font or density redesign;
no unconditional new navigation, duplicate controls or competing layout owners.

## Implementation and acceptance ledger

Each row remains open until its real registration, rendering/interaction and
unload behavior are tested. Existing capability tests and a default UI comparison
are required in addition to new-plugin tests.

| Scope | Status | Acceptance |
| --- | --- | --- |
| Plugin settings tabs | implementation + focused tests + real Desktop file: integration passed; visual review pending | Real localized tabs/panels; existing inventory and filters preserved; unload falls back |
| Plugin config cards/forms | keyed cards plus three built-in forms implemented; controller/UI tests, real Host save/reset and visual review passed | Host config read/write, actual schema, existing settings preserved |
| Sidebar additive actions | implementation + focused tests + real Desktop wide/narrow/unload passed | Correct owner, no empty wrapper, collapsed/expanded behavior |
| Workspace/directory selection | lifecycle controller implemented; 5 tests passed; surface integration open | Open/cancel/picked/error lifecycle, one workspace mutation authority |
| Session export | native plugin enabled + dialog adapted/tested; actual Desktop ZIP saved; ordinary Web download verification pending | Native command download on Web/Desktop without duplicate existing action |
| Official session open from no-selection | implemented; 17 focused tests + real Desktop plugin open passed | Explicit opens follow the existing Amiba path; startup restore stays suppressed. Clear and direct-child navigation need separate audit |
| Existing header/model/plan/command/reference extensions | open | Regression tests plus dependency/owner audit |
| Official component styles | open | Scoped compatibility assets; no changes to Amiba tokens or global defaults |
| Message actions | open | Exact MessageId, no arbitrary turn-to-message mapping, existing bubbles preserved |
| Turn tail/deliverables | open | Real turn/step/business data and unchanged default rendering |
| Input zones | open | Correct reference offsets, draft images, revisions and submission phases |
| Chat/command/workflow nodes and views | additive conversation views implemented; focused tests, real Desktop registration/session injection/unload and screenshot review passed; nodes/commands/workflows open | Official data and callbacks, independent lifecycle, existing presentation retained |
| Tool subcalls/inspect | subcalls implemented; 26 runtime + 7 UI tests passed; inspect open | Real dispatch tree and trajectory target; no fabricated empty children |
| Dynamic Cordis UI | open | Plugin/package/run ownership and disposal, current tools preserved |
| Latest additive contracts | open | Versioned compatibility assessment and implementation where semantics can be preserved |
| Exclusive whole-surface ownership | boundary pending verification | Do not let a second root/composer take over existing capabilities |
| Full input machine/private DOM/native cross-platform APIs | boundary pending verification | Identify exact unsatisfied contracts instead of advertising partial implementations as complete |

## Verification log

Implementation in progress. No completion claim yet.

### Verified first batch

- Inventory tab selection, removal, keyboard navigation and unchanged filter state.
- Real SlotCore declarations and keyed configuration registration matched against
  the Host-served namespace list; subscriptions and declarations dispose.
- Sidebar tests: 22 passed, including existing settings and the added footer action.
- Existing inventory tests: 3 passed. New tab tests: 2 passed.
- Native export dialog: no idle DOM, session isolation, progress/error/dismissal.
- UI, SDK and runtime-inventory typechecks; shell and inventory production builds.
- Cold runtime preparation exposed an existing build-order omission: type-only
  workspace providers in devDependencies were not built first. Included those
  prerequisites; the complete workspace plugin dependency graph is acyclic.

### Evidence correction

The earlier external audit used local official source as an rc.2 proxy. The
actual installed `@deepseek-ai/dsh-client-ui-settings-plugins@0.1.1-rc.2` declares
`settings.plugin.item` as keyed, although that source checkout says list. The
implementation follows the actual installed declarations and client bundle.
Do not treat that local source commit as proof of byte-identical npm APIs.

### Completed-turn message-action finding

The installed rc.2 `TurnTailNodeView` dispatches assistant actions with
`closing.finalNode.messageId`. Its `tailData` selects the last finalized
assistant step containing nonblank text, ordered by final-node sequence. A
synthesized interrupted step may be that closing step and have no MessageId;
in that case the action slot is absent. Therefore Amiba's merged bubble is
not itself a blocker. Preserve this exact selection across step finalization,
retry and interruption, then carry the canonical identity to the existing
completed-turn surface. No bubble split or arbitrary first/last UI id is needed.

- Code Mode children now reach occupied toolviews in live and restored sessions.
- Ordinary tool rows remain byte-identical with an unoccupied toolview.
- Removing all plugin tabs restores the inventory DOM and preserves its filter.

### Desktop transport follow-up

Real file-renderer smoke revealed two origin assumptions requiring pinned patches:
settings classified file: as remote despite the managed loopback transport, and
session ZIP anchors retained the unresolvable dsh.internal hostname. Both patches
use the explicit desktop transport URL only on file: pages; ordinary Web origin
classification is unchanged. Connection authority tests cover local, remote and
missing transports. Real Desktop file: integration passed: Host namespaces were read, tabs/cards rendered
and unloaded, footer wide/narrow updated, and a nonempty ZIP with PK signature was
saved while preserving the product page. The file download uses a narrowly validated
preload handoff to Electron's native downloader; no request-header override remains.
Ordinary Web retains the official browser anchor path.

- Final full Desktop build and production dependency verification passed after the native download handoff; 14 download/boot boundary tests passed.

### Conversation view integration fixture

The first Desktop probe created and exported a session but opened it only through
`ctx.sessions.open`. Amiba deliberately clears official selection while its own
selection is empty, so no active conversation was displayed and the view tab did
not appear. The view probe now uses the existing `amiba:open-session` navigation
path to establish the product session. The follow-up below replaces this fixture workaround with the official API.

- Conversation views: 2 UI tests and 1 metadata-source test passed; shell and SDK
  typechecks passed. Full Desktop production build passed. Real installed-plugin
  smoke passed with actual session props/inject, mounted native chat and unload
  fallback. Screenshots reviewed after dismissing the export dialog; the native
  composer returns without residual tabs. Existing plugin HMR/detach checks and
  actual ZIP download also passed in the same run.

### Settings form scope correction

The actual installed rc.2 `ui-settings-plugins` client does not generate an
arbitrary form for every schema. It registers three explicit cards: `shell` (Bash),
`agent-loop`, and `web-search-deepseek`, each with its own controller. Custom
namespace cards are already supported; parity with the official package still
requires those three built-in forms and their real staged-save/secret behavior.
An invented universal schema editor is not required to reproduce this version.
Newer version contracts remain a separate audit item.

### Explicit session-open compatibility

Pinned `dsh-client-runtime@0.1.1-rc.2` now publishes per-open provenance before
its synchronous selection notification. Only the initial workspace policy labels
its own request `initial`; ordinary public `open(id)` labels it `explicit`.
The bridge can therefore follow a plugin request from Home without following
restored/startup selection. Failed opens preserve their original exception and
previous metadata. A newer explicit request invalidates older queued draft
projections; existing active-session fallback behavior is preserved.

- 14 bridge tests and 3 tests executing the actual patched runtime methods passed.
- Shell typecheck and final full Desktop build/production verification passed.
- The real Desktop fixture now uses `ctx.sessions.open(id)` directly from Home.
  Session-scoped view props/injection, native chat preservation, unload, settings,
  footer, actual ZIP save, plugin HMR and detach all passed in the same run.
- This does not certify official `clear()` or catalog-addressed child rendering;
  those navigation semantics remain to be audited separately.

### Built-in configuration forms

Runtime inventory now supplies the official `shell`, `agent-loop`, and
`web-search-deepseek` cards using Amiba primitives. The pinned settings package
exposes a standalone controller entry containing the exact controller regions
from its client bundle. This is statically bundled into the adapter: importing
the disabled whole settings UI as a dynamic client dependency was rejected by
the real module loader. The package's original settings page remains disabled.
A test verifies controller-region identity before exercising the standalone code.
Controller scope subscriptions and credential invalidation subscriptions are tied
to the owning plugin fiber. Existing inventory is still the default selected tab.

The official search controller previously treated an existing configured key as
proof that a replacement key saved, even after rejection. Both its original and
standalone implementations now check the write result and retain failed drafts.

- Four real-controller tests passed: staged save/reset, invalid numbers, rejected
  field saves, blank secrets, successful keys and rejected key replacement.
- Four UI tests passed: input/write gating, masked secrets, discard, unchanged
  empty inventory layout and tab selection/unload. External tab panels now scroll
  so longer configuration forms remain reachable.

- Final complete Desktop build and production verification passed. Real installed
  Desktop smoke saved and reset a field through each of the three forms, verified
  editing alone did not write, and checked that the password input remained blank.
  Screenshots reviewed at the top and bottom of the scrolling configuration panel.
  Credential success/rejection uses isolated controller fixtures, not real secrets.
- The same real run passed plugin-tab shadow/unload fallback, footer width,
  explicit session open, conversation view injection/unload, actual native ZIP
  download, plugin HMR/detach and preservation of the installed user profile.

### Directory flow lifecycle groundwork

`directory-flow.ts` supplies real open/busy/outcome state over an occupied slot,
awaits Host adoption before returning the path, cancels on occupant replacement or
unload, and ignores stale callbacks and late adoption results. With no occupant,
it calls the existing platform chooser with the exact original starting path.
Five lifecycle tests and shell typecheck passed. It is not yet wired to a product
surface, so directory-flow compatibility is not claimed complete.

Integration evidence and remaining requirements:

- The installed native picker nests injection of BOTH directory-flow keys before
  registering either one. Declaring only the Home key does not activate it.
- Its `pick()` calls `ctx.workspaces.pickDirectory()` without a starting path;
  Amiba Home and workspace-project pickers currently pass a starting directory.
  Preserve that capability when adapting the default native occupant.
- The native driver reads `outcome.current` when an asynchronous picker returns.
  Reopening before an older picker settles can route that old result into the new
  request. Surface integration must isolate request instances or fix that driver,
  in addition to the controller's own stale-callback guards.
- Home currently selects an intended path; workspace-project actions feed the
  existing development-project authority. Keep those caller actions, use real
  Host workspace adoption for the contributed flow, and do not fabricate owner
  callbacks or silently replace a project/session mutation path.
