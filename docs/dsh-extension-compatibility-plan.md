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
| Plugin config cards/forms | keyed cards implemented/tested; generic form work open | Host config read/write, actual schema, existing settings preserved |
| Sidebar additive actions | implementation + focused tests + real Desktop wide/narrow/unload passed | Correct owner, no empty wrapper, collapsed/expanded behavior |
| Workspace/directory selection | open | Open/cancel/picked/error lifecycle, one workspace mutation authority |
| Session export | native plugin enabled + dialog adapted/tested; actual Desktop ZIP saved; ordinary Web download verification pending | Native command download on Web/Desktop without duplicate existing action |
| Existing header/model/plan/command/reference extensions | open | Regression tests plus dependency/owner audit |
| Official component styles | open | Scoped compatibility assets; no changes to Amiba tokens or global defaults |
| Message actions | open | Exact MessageId, no arbitrary turn-to-message mapping, existing bubbles preserved |
| Turn tail/deliverables | open | Real turn/step/business data and unchanged default rendering |
| Input zones | open | Correct reference offsets, draft images, revisions and submission phases |
| Chat/command/workflow nodes and views | open | Official data and callbacks, independent lifecycle, existing presentation retained |
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
