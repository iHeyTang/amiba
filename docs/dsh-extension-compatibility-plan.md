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
| Workspace/directory selection | Home/project surfaces wired; 17 focused tests and Desktop Home/project smoke passed; native IPC bridge verified with OS boundary stub; browser picker open | Open/cancel/picked/error lifecycle, one workspace mutation authority |
| Session export | native plugin enabled + dialog adapted/tested; actual Desktop ZIP saved; ordinary Web download verification pending | Native command download on Web/Desktop without duplicate existing action |
| Official session open from no-selection | implemented; 17 focused tests + real Desktop plugin open passed | Explicit opens follow the existing Amiba path; startup restore stays suppressed. Clear and direct-child navigation need separate audit |
| Existing header/model/plan/command/reference extensions | open | Regression tests plus dependency/owner audit |
| Official component styles | open | Scoped compatibility assets; no changes to Amiba tokens or global defaults |
| Message actions | open | Exact MessageId, no arbitrary turn-to-message mapping, existing bubbles preserved |
| Turn tail/deliverables | chain and produced-files row verified on Desktop; prose references and standalone Web open | Real turn/step/business data and unchanged default rendering |
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

### Native directory picker request isolation

Pinned `dsh-client-ui-directory-picker-native@0.1.1-rc.2` now captures callbacks
per open cycle and discards results after close/reopen or unmount. Re-renders and
React StrictMode do not launch duplicate pickers; synchronous picker exceptions
reach the owner's error callback instead of escaping the React effect.

The test executes the real installed component extracted from the package bundle.
The same six cases against the unpatched managed runtime reproduced five failures;
all six pass with the patch, alongside the five directory-flow controller tests.
Surface integration, starting-directory preservation and real Desktop interaction
remain open; this patch alone does not establish directory-flow compatibility.


### Directory flow surface wiring

Both official single/root directory slots are declared together. A context bridge
connects Home and the workspace project's existing choose/add-folder actions;
no additional idle DOM, replacement controls or styles are introduced. The caller's
actual path adoption runs while the owner is busy: Home stores its intended path,
and project actions use the existing development service. This deliberately does
not create an extra Host workspace or session when merely choosing a Home path.
The controller still accepts Host workspace adoption when used by such a caller.

The patched native occupant accepts an optional Amiba native picker callback to
retain the original platform chooser and starting path. Other occupants receive
the unchanged required official owner contract. Each opened request has a separate
React key, including when close/reopen notifications are batched together.

Validation: 6 controller, 7 actual native component, and 4 chooser-context tests
passed; shell typecheck and complete Desktop production build passed. The real
Desktop smoke passed Home registration, cancel/reopen, stale callbacks and path
adoption, as well as existing settings/view/export/HMR checks. Native picker
interaction, project-surface integration and browser picker styling still require
runtime verification before marking this entry done.

Final Home smoke also asserts no session IDs are added by directory selection and
both default directory registrations remain after probe unload. The captured Home
screenshot was visually reviewed: original layout/composer/selected-path control
remain intact. Full smoke log: `/tmp/amiba-directory-desktop-smoke-final.log`.


### Project directory integration verified

The complete Desktop smoke now opens the existing workbench and its file tree,
uses the actual New project / Add folder buttons with a registered directory-flow
occupant, and reads the native project's persisted state. Verified creation,
cancellation without mutation, folder addition retaining project identity, and
session location binding to the newly selected folder. Fixture directories are
canonicalized with realpath to match the existing macOS project service behavior.
No production behavior or style changes were needed for this verification.

The final full smoke passed (`/tmp/amiba-directory-project-verified.log`), including
all previous Home/settings/view/export/HMR checks. The project-pane screenshot was
visually inspected. Default OS picker interaction and browser-picker rendering
remain separate open checks; fixture-occupant success does not prove those.


### Default native directory bridge verified

The Desktop smoke now removes the test Home occupant and clicks the existing
chooser again, exercising the installed official native component, its optional
Amiba callback, preload, and `workspace:choose-directory` main IPC. A temporary
native fixture replaces only `dialog.showOpenDialog` for directory requests and
records its options; it restores the original function on disposal/HMR.

The recorded defaultPath equals the prior Home selection, the options include
openDirectory, the returned path reaches the Home control, and session IDs remain
unchanged. Full regression smoke passed (`/tmp/amiba-default-native-picker-smoke.log`).
This verifies the production bridge, not a human interaction with the OS window.
The browser directory picker still requires activation, rendering and style checks.

### Browser directory picker investigation and scoped styles (verification pending)

The smoke can now use `--browse-directory` to set a temporary SSH launch signal,
which makes the official auto-picker compose its browse backend and client. The
actual directory listing and Cancel interaction succeeded. Visual inspection
found a transparent dialog painting over the Home composer: the official theme
is intentionally excluded, leaving the browser's aliases unresolved.

Added `official-directory.css`, scoped exclusively to the pinned rc.2 browser and
create-folder dialog CSS-module roots. It maps aliases to Amiba tokens and supplies
the missing dialog surface. No global official aliases are introduced. A fresh
Desktop build is running; runtime computed-style assertions and screenshot review
must pass before claiming the styling fixed. Directory path editing, creation and
selection remain to be tested with this real browse occupant.


### Browser directory dialog verified

Full production build and `--compat --browse-directory` smoke passed. Computed
styles prove the dialog background is opaque and the official background alias is
absent on the product shell. Both main and create-folder dialog screenshots were
visually reviewed. Through the official backend the test edits a real path,
creates a folder inside the temporary profile, selects it, and verifies its real
filesystem identity and the absence of new sessions. Cancel/reopen and all earlier
settings/export/project/view/HMR checks also passed. Log:
`/tmp/amiba-browser-directory-final.log`.

The browser backend returns lexical absolute paths; Home intentionally retains
that path. Unlike project-service normalization, tests compare its realpath only
when checking filesystem identity. The Open button must be awaited until enabled
after the post-create directory scan. No production behavior changes were needed
for those two test corrections. This run used the browser picker in Electron's
web renderer; a standalone Web deployment remains separately unverified.

### Turn-tail prerequisite: headless official conversation definitions

The installed rc.2 `conversation.chat.turnTail` is a session-scoped chain with a
real engine TurnLocation, closing assistant seq (or turn/end seq), and openFile.
Its Turn/Step data stores cannot be replaced with Amiba bubble ordinals. The
currently excluded ui-conversation package also owns the business definitions and
chat target builder that publish assistant-step and turn-tail data.

A source-level runtime test executes the actual package's contiguous headless
registration region, without React, DOM, slots or input services. Both tests pass:
registration includes assistant-step / turn-tail plus the chat target, and the
actual empty chat builder preserves the supplied engine timeline by reference.
This proves a headless extraction is feasible at registration time. It does not
prove complete event projection: external helpers used during event processing
must still be included, tested, packaged and wired before adding the render seat.
No turn-tail compatibility is claimed from this prerequisite test alone.

### Headless conversation module integrated (Desktop verification pending)

Added a pinned `ui-conversation/headless` ESM export. Its exact lexical dependency
closure is selected with the TypeScript symbol checker from the original bundle;
the only import is the official client runtime. No React, DOM, root slots or
composer state is included. The shell statically bundles this export and registers
its data definitions/target through a scoped conversationEvents/conversationViews
fiber, disposing it with the shell.

Five tests pass, including exact standalone/source identity and real history/live
projection. Tests run the actual official ConversationNodeAssembler and conversion
helpers extracted by the same dependency traversal, without engine substitutes.
They verify turn/start/end, step boundaries, closing seq/message ID and reference
identity between the chat node and timeline TurnLocation. Shell typecheck passed.
A complete Desktop build is running; actual plugin loading, lifecycle and regression
checks are still required. The turn-tail render seat is not yet implemented.

Headless follow-up: declared the actual runtime module in `dsh.client.external`
after the bundle verifier rejected its missing arrival dependency. The shell's
own production build now passes. Seven source/engine tests pass, including tool
call/result preservation across registry rebuild and history replacement, and
absence of a footer on an unfinished turn. A fresh complete Desktop build is
running. The smoke now checks the real mounted definitions and reads the chat
timeline through a plugin view's actual useSession hook.

Headless Desktop verification completed: full production build and actual
`--compat` smoke passed (`/tmp/amiba-headless-desktop-smoke.log`). The probe
asserts registered assistant-step / turn-tail definitions and the chat target,
then reads the real session chat timeline/node store through a contributed view's
useSession hook. Existing Home/project directory, settings, native ZIP, view,
HMR and detach checks pass. The stock conversation page remains disabled.

Next render prerequisite: Amiba groups bubbles by user messages, which must not
be treated as engine turn numbers. Carry the exact event turn number through
live/history message projection before mapping footer render sites, including
completed tool-only replies. The headless module alone is not a completed footer
adapter.

### Exact engine-turn currency carried through Amiba messages

Added optional runtimeTurn metadata from the actual nonnegative safe-integer DSH
turn number to bridge events, engine snapshots, historical assistant messages and
live/snapshot UI projection. The existing turnId and message/bubble identities are
unchanged. Missing or invalid turn numbers do not borrow the event sequence or
user-message ordinal. No new display or styling is introduced.

Seven mapping tests plus sixteen closing-assistant tests pass. Engine tests also
verify that a passive run's stream event and recovered snapshot preserve the
same exact number; the full engine test file passes. Shell typecheck passed.
The footer renderer still needs to use this metadata to read the corresponding
engine TurnLocation, handle missing history and avoid duplicate placement.

### Turn-tail render adapter: visible reply integration verified

Root now declares the official session/chain slot and forwards renderSlotChain.
The adapter resolves the actual session face, subscribes with bound methods, reads
the exact timeline TurnLocation by runtimeTurn, and uses official turn-tail data
for the closing seq (or turn/end seq when no closing assistant exists). The file
opener delegates to the existing workbench path behavior. No Cordis context is
passed into UI components.

Message rendering places the extension after the last visible assistant reply
with that exact engine turn number, before its action contribution. The owner
lookup does not require assistantMessageId; execution-only presentation anchors
remain to be wired. It adds no wrapper; all-declined chains
remain empty. Missing data and open turns render nothing. Three adapter tests and
41 message chrome tests pass, including exact reference/opener forwarding,
subscription disposal, duplicate prevention and unchanged empty-slot DOM. Shell
typecheck and the full Desktop production build passed.

The real installed Desktop fixture writes a deterministic turn through the Host
session log, using only its temporary workspace. The contributed chain displays
after the actual historical reply, receives the identical runtime TurnLocation
and closing seq, and disappears cleanly on unregister. Existing settings,
directory, ZIP, view, HMR and detach checks passed in that same run.

Remaining: live turn/data updates, actual file opening through the contribution,
execution-only presentation, and completed turns with no visible reply at all. Do not claim full turn-tail support
until that placement and end-to-end validation are resolved.


### Turn-tail placement beyond visible replies

The UI now locates each tail after the last rendered item belonging to the exact
engine turn, including execution disclosures and run boundaries. Existing
execution groups are not split merely because a chain exists. Closed turns with
no projected assistant row receive presentation-only anchors ordered by the
engine end sequence; these never enter persisted messages or submission history.
No content is emitted for an unclaimed chain, including a conversation with no
visible messages. Session changes dispose the old source and discard its anchors.

- 43 message chrome tests and 4 adapter tests passed, covering execution-only
  replies, empty history, sequence placement, session switches and unchanged
  empty-slot DOM. Shell typecheck and full Desktop production build passed.
- Real installed Desktop smoke passed: a Host turn remains invisible to the
  tail chain while open, then publishes its exact end sequence after a no-reply
  completion. The contributed opener displays actual file contents through the
  existing workbench. Dynamic unregister removes both historical and live tails;
  settings, directory, ZIP, view, HMR and detach regressions pass in the same run.
- The raw official session.create({cwd}) does not itself establish Amiba's
  separate per-session file-workspace binding. The file-opening smoke explicitly
  binds its temporary session before opening a file; this must not be counted as
  automatic workspace parity for official session creation/navigation.


### Official produced-files row enabled

The original ui-deliverables package is enabled again. Its actual event
accumulator, selector, localization, responsive chip layout and optional
chatFileMentions service run under their own plugin lifetime. The disabled
whole conversation UI stays disabled. Only the pinned row's CSS-module root
receives Amiba color aliases; no global theme or existing review card changes.

A "." tail open request uses the existing session-validated external-path
adapter, so the overflow row's Show in folder action opens the directory rather
than trying to preview it as text. Tail open failures render an error, and old
asynchronous outcomes cannot leak across turns or sessions.

- Actual official assembler/selector tests passed: successful mutation paths,
  duplicate paths, read-only/failed-call exclusions, closing-sequence cutoff,
  turn isolation and definition removal/rebuild. Five tail adapter tests passed,
  including rejected opens and stale outcomes. Shell typecheck passed.
- Full Desktop build passed. Real installed-plugin smoke derived seven files
  from Host tool-call views, opened actual file contents, and reached Electron's
  validated directory opener. Only the OS folder-open boundary was stubbed.
  Historical/live/empty tails, dynamic unregister, original settings, directory,
  ZIP, view, HMR and detach checks passed in the same run. Screenshot reviewed.
- Prose file references remain open: Amiba's current Markdown links handle
  explicit paths, but not the official unique-basename resolver. It must apply
  to the exact closing assistant content, including merged multi-step bubbles.
  Standalone Web and remote-host behavior also remain unverified.


### Closing-prose link provenance groundwork

Historical text timeline items now retain the exact finalized assistant/message
sequence as optional runtimeSeq metadata. A merged bubble can therefore distinguish
an earlier step's text from the closing step, including repeated filenames,
without changing its content, grouping or rendering. Unknown/live chunks remain
unattributed; no sequence is inferred from presentation IDs or string matching.
23 runtime/history tests and the shell typecheck passed.

Still required for prose links: live chunk/finalization provenance (including
retries), propagation through the native condensed/interleaved Markdown views,
and the actual official resolver's lifecycle, matching and file opening. Do not
apply a closing resolver to an entire merged bubble or assume Markdown node
positions remain global when Streamdown splits the source into blocks.


### Live text provenance and completed-Markdown positions

The DSH bridge now carries exact chunk step numbers and append-finalization
sequence/text, plus retry resets. The chat engine and stream buffer share a
source-range updater. Existing text and text-item grouping are unchanged;
metadata covers only attributable substrings of merged items. Retry resets
retire old attribution while leaving visible text alone. A finalization is
accepted only when its canonical text exactly matches that step's streamed
ranges; mismatches revoke any earlier finalization instead of guessing.
History items extended by later chunks retain their earlier source as a range.

Source-range arrays are replaced rather than mutated. Engine snapshots copy
text timeline items, so finalizing a later event cannot change an already
published snapshot. Runtime bridge/engine, retry/mismatch, snapshot and real
stream-buffer tests passed, as did the shell typecheck and existing message
chrome tests. This is provenance plumbing, not a completed prose-link claim.

The actual installed Streamdown static path renders the complete source in one
Markdown processor (its streaming path splits blocks). A real ChatMarkdown
rendering test confirms that completed inline-code nodes preserve full-source
offsets across multiple paragraphs, including repeated filenames. The next step
can therefore gate the official resolver by exact finalized-source ranges in
static native views, while preserving existing explicit-path links. Custom
source-transforming Markdown extensions must not be assumed to preserve offsets.


### Official closing-prose resolver connected

UI Shell now supplies the original chatFileMentions.forClosing provider with the
actual session TurnLocation, closing sequence and existing file opener. Native
Markdown supplies a source sequence only when the inline-code node lies wholly
inside a finalized text range. Existing explicit-path links remain the fallback;
unknown/earlier text and all streaming Markdown receive no new basename links.
The provider uses React context only and adds no DOM or style wrapper.

Source ranges are translated through the native result join and outer trimming.
Plain merged replies and condensed tool/reply results retain their native text
and layout. Ambiguous or noncontiguous text transforms decline attribution
rather than assigning a nearby source. The renderer uses the existing inline-code
and file-link styles.

- 53 message/file-link tests, 2 source-range translation tests and 6 adapter tests
  passed. These cover repeated filenames, unchanged empty-provider DOM, original
  explicit links, condensed tool replies, exact owner forwarding and missing
  session sources. Shell typecheck passed.
- Full Desktop build passed. Real installed-plugin smoke clicked a unique bare
  filename in a live finalized reply and opened actual file contents. Produced
  file chips, validated directory IPC, settings, workspace, ZIP, conversation
  views, HMR and detach passed in the same run. Screenshot reviewed.
- Remaining prose cases: finalized text represented inside folded process
  narration; noncontiguous body transforms (such as inline thinking markup);
  interrupted synthetic final nodes with no assistant/message event; a dedicated
  historical/reopen Desktop check; custom source-transforming Markdown providers;
  and standalone Web/remote-host behavior. Overall compatibility stays open.

### Folded narration and thinking markup source mapping

Finalized prose retains its exact source ranges when displayed inside the native
execution disclosure. Thinking extraction now reports retained raw slices to
the source mapper; the existing extracted body, whitespace rules, disclosure
classes and visible text are unchanged. Adjacent ranges merge only when they
share a source sequence. Extracted reasoning receives no prose attribution.

- 51 UI tests passed, including unchanged DOM with an empty provider, folded
  narration links, thinking removal, repeated blocks and separate source events.
  The existing thinking helper regression and Shell typecheck passed.
- Full production Desktop build and installed-plugin smoke passed. The smoke
  opens a real produced file from the final prose, expands the native process
  disclosure and verifies both source-mapped links. The screenshot was reviewed
  with the disclosure expanded and actual file contents open in the workbench.
- Synthetic interrupted finals, historical/reopen Desktop coverage, custom
  Markdown transforms and standalone Web/remote behavior remain open.

### Interrupted-final contract verified against the installed assembler

Four additional integration cases replay real official definitions through the
installed ConversationNodeAssembler, in both history and live modes, with either
a step boundary or only a turn boundary. All 12 headless integration cases pass.

The interrupted final has no message ID and uses the actual boundary sequence
minus the official 0.9 offset. Retry discards earlier chunks; block-end can
replace the accumulated text. Registry rebuild preserves this final node.
Consequently the prose adapter must read the actual final node, compare complete
step text against its final text blocks, and avoid inferring attribution solely
from a step number or the visible delta text. Production code must not recreate
the synthetic offset. This establishes the contract; interrupted prose mapping
is still unimplemented and is not marked supported.

### Live synthetic interrupted prose connected

Native text source ranges now preserve pending step identity through joining,
trimming, thinking extraction and folded narration. The message wrapper receives
the original assistant timeline. For a closed turn with an official interrupted
final and no message ID, it compares all pending text of the actual final step
with the final node's complete text blocks before consulting the original file
resolver. It uses the actual owner sequence, never a reconstructed offset.
Finalized ranges still require an exact sequence match. Streaming Markdown
remains unlinked, and removed/retried or corrected text cannot gain attribution
from a step number alone. Existing text and layout remain unchanged.

- 52 UI tests and 7 adapter tests passed; Shell typecheck passed.
- Full Desktop production build passed. The installed-plugin smoke's new
  --interrupted-prose variant emits real Host chunks and boundaries with no
  assistant/message event. It asserts the actual fractional final sequence and
  missing message ID, opens the real file from prose, expands folded narration
  and checks both links. The screenshot was reviewed. Settings, directory, ZIP,
  produced-file row, HMR and unload checks passed in the same run.
- Historical draft-only replies still lack source metadata in the history
  projector. Reopen coverage and that metadata bridge remain required, along
  with custom Markdown transforms, standalone Web and the broader open ledger.

### Historical draft provenance and renderer reload verified

The history projector tracks draft-only text ranges with the shared append/reset
helper and returns them as assistantDraftSource metadata. It leaves the existing
body selection (final text or draft), assistantTimeline rows, tool order and
reasoning untouched. A finalized message clears draft metadata; retries revoke
old step attribution without rewriting the existing displayed draft text.
The native Markdown mapping and turn provider consume this metadata without
inserting a timeline row, which would otherwise change tool-only layout.

- 24 history/runtime tests and 53 UI tests passed; Shell typecheck passed.
  The UI regression compares complete DOM before and after draft metadata on
  a tool-only historical reply, then verifies the new link.
- Final production Desktop build passed after removing redundant reset code.
  Two installed-plugin smoke runs passed: --compat --reopen-prose, and the same
  with --interrupted-prose. Both reload the entire renderer and require a
  pre-reload window marker to disappear before reopening the durable session.
  They click a restored prose link and verify actual file contents. The
  historical interrupted-reply screenshot was reviewed; native review and
  execution surfaces remain present. Settings, ZIP, directories, produced-file
  rows, HMR and unload checks pass in both runs.
- Existing history rules may omit a later unfinished draft when earlier final
  text already exists; this change does not rewrite that display policy.
  Custom Markdown transformations, Web/remote behavior and the remaining
  extension ledger are still open.

### Official public clear bridged to native deselection

The pinned runtime now marks public clear requests before its synchronous
selection notification. The bridge forwards only a new marked request, suppresses
its own clear projection, and cancels deferred opens. Unmarked internal selection
loss retains the existing Amiba-authoritative policy. The shell invokes the
existing sessions.deselect action, preserving tabs, messages and native layout.
A navigation revision also prevents a superseded list refresh from reopening
the cleared session or changing the surrounding shell chrome.

- 16 bridge tests and Shell typecheck passed. Tests cover explicit clear, own
  projection echoes, unmarked internal loss and cancellation of a deferred id.
- Full Desktop build passed after reverting the previous patch in the derived
  managed cache so preparation could apply the updated complete patch.
- Real installed-plugin smoke calls sessions.clear, checks empty selection and
  absent transcript, verifies unchanged session ids and reopens the same transcript.
  The complete --compat --reopen-prose run passed, including files, directories,
  settings, ZIP, HMR and detach. During capture the main window became hidden;
  restoring it through the existing native open-in-main action let the same run
  complete without a restart.
- Follow-ups: include patch identity in dependency-cache reuse so patch upgrades
  need no manual cache repair; verify/cancel navigation already inside native
  openTab metadata/history loading. Directory adoption must preserve explicit
  Amiba bindings and default-directory choices. Broader compatibility stays open.

### Managed dependency cache checks patch identity

Runtime preparation now records a digest of sorted patched package specifiers
and their patch contents, independent of patch file location. Reuse requires
this digest as well as the existing dependency/platform checks. A legacy marker,
modified patch, removed patch or different patched version starts from locked
registry files, so a partially old patch set cannot be copied into an upgrade.

The two dependency-reuse tests cover unchanged/reordered patches, changed
contents, removals, changed versions and legacy markers. The real upgrade build
started from the existing marker without a patch digest, ran locked npm ci,
applied the reviewed patches from clean files and completed the production
Desktop bundle. The resulting marker contains patchSetHash. No manual cache
repair was used for this validation.

### Cancel native session opens before their asynchronous work completes

Two regression tests first reproduced late reopening after deselect: one while
history was pending from Home, and one while an unlisted session's metadata was
pending. Native navigation now assigns its cancellation token before metadata
lookup or outgoing flush, carries that token into activation and checks it after
each loading boundary. Deselect invalidates pending opens even when the current
visible state is already Home. Tabs committed before cancellation remain open;
a canceled metadata lookup cannot append a new tab or select it.

All 21 session-store tests and Shell typecheck passed. The full production
Desktop build passed and reused the same patched dependency tree, verifying
the positive cache-reuse path after the preceding legacy-cache migration.
The installed-plugin --compat --reopen-prose run passed without manual window
recovery: official clear/reopen, history reload, ZIP, files, directories, settings,
HMR and detach. Artificially delayed metadata/history cancellation is covered
by the state-store regressions; the Desktop run verifies normal plugin routing.
No UI layout or style code changed for this fix.

### Markdown transform identity, updates and source ownership

The real Streamdown 2.5 pipeline cached processors by function names, causing
distinct extensions with same-named attachers to reuse earlier transforms.
Amiba now adds inert identity metadata to each remark/rehype pipeline, using
weak identities shared across module instances and the extension revision.
The original plugin functions, options, order and Unified deduplication remain
in place. Remark and rehype marker attachers have separate identities to avoid
merging their options. A pipeline identity key also refreshes Streamdown's
rendered output when implementations change without a version bump; unchanged
pipelines retain mounted component state.

- 70 Markdown/message tests passed, followed by all 8 source-position tests
  after adding an ordinary-rerender mount-stability regression (71 distinct
  checks in total). Shell typecheck and final production Desktop build passed.
- Actual MarkdownProvider/Streamdown tests cover inserted paragraphs, rewritten
  anchored code, reordered paragraphs, padded multi-backtick spans, and newly
  generated code without source positions. Original positions retain message
  ownership even if the displayed value changes. No new text-equality restriction
  was added. Generated nodes without provenance cannot be assigned to a merged
  reply's original message; explicit native path links remain available.
- Real installed-plugin smoke registers, replaces and removes two same-name,
  same-version transforms through amiba.markdown.extension. It verifies replacement
  output, retained produced-file links and complete unload. Full --compat
  --reopen-prose passed, including settings, clear/reopen, files, directories,
  ZIP, history, HMR and detach. The post-unload history screenshot was reviewed.
- Hidden test windows previously stalled compositor capture. The native smoke
  fixture now shows only its own main test window before capture; the final
  entire run completed without manual recovery. No production window policy
  or stylesheet changed. Web/remote and the remaining extension ledger stay open.

### Catalog child history transport (2026-09-12)

- Verified the installed rc.2 `SubagentsApi` contract and official runtime's
  `Session.history`: catalog children use `subagent.history` with their durable
  direct-parent address, not ordinary `session.history` or Agent activation.
- Added the address to the platform history options, the exact addressed RPC
  to DshApiClient, and address propagation across all `loadMessages` pages.
  Ordinary callers retain their existing transport. A mismatched child ID fails
  before RPC; catalog failures propagate without fallback or implicit resume.
- All 25 tests across platform-adapters, DshApiClient and session storage passed;
  both app-runtime and shell typechecks passed. Tests cover both child modes,
  pagination, render views/projections, mismatched addresses and host errors.
- This is transport groundwork, not complete child navigation: address discovery,
  shell open/reopen metadata, selection intent, child prompt/interrupt semantics
  and actual renderer verification remain open. No UI or stylesheet changed.

### Retained child selection projection (2026-09-12)

- The selection bridge now recognizes official `subagentAddress(id)` as an
  openable target even when the child is absent from root-list `ids`. Re-selecting
  an existing addressed child no longer leaves official scoped slots deferred.
- Deferred selection checks address availability again in its queued callback;
  disappearance, reappearance and newer deselection preserve cancellation rules.
  Immediate open failures also return to deferral instead of losing the target.
- A regression test exposed synchronous re-entry through the bridge's own
  `clear()` notification following a failed open. Own clear notifications now
  update the observed current selection and return without recursively opening.
- All 21 selection bridge tests and shell typecheck passed. This proves bridge
  state behavior, not full child UI support. Public `openSubagent` intent from
  Home, native child metadata/address persistence, history wiring and child
  interaction semantics still need integration and renderer verification.

### Native child metadata and history lifecycle (2026-09-12)

- Added a validated, copied catalog address to native session metadata and its
  local sidecar. It is a navigation hint; addressed RPCs remain Host-validated.
  Invalid addresses fail before navigation, and conflicting Host parent IDs are
  rejected. Root-list absence no longer prevents creating child tab metadata.
- `openTab(id, address)` loads addressed history; switching back, exporting and
  resolving historical message IDs retain the same transport. New store instances
  still start at Home and can recover an explicitly reopened child's saved address.
  Discovering an address for the already selected ID forces a transcript reload.
- All 34 session-store/storage/platform tests passed, including unlisted children,
  refresh, tab switching, export, store recreation, malformed addresses, Host read
  errors and copying caller-owned address objects. App-runtime and shell typechecks
  passed. No UI source or stylesheet changed.
- Official navigation events do not yet supply this optional address. End-to-end
  event integration, child prompt/interrupt semantics and Desktop renderer/build
  verification remain open; these unit tests do not establish full child support.

### Official addressed-open event wiring (2026-09-12)

- Official selection forwarding now copies the retained child address into the
  existing `amiba:open-session` event. ProductShell passes it to native `openTab`
  and retains it if the session store is not ready yet. Clear still discards the
  entire deferred request and invalidates outstanding navigation revisions.
- Ordinary opens keep their existing event semantics. All 22 selection bridge
  tests and shell typecheck passed; the added check verifies exact direct-parent
  identity and that the forwarded object does not alias the runtime's address.
- Before Desktop end-to-end verification, child interaction transport must be
  completed: the existing DshChatEngineClient unconditionally calls session.create
  and session.prompt, and abort calls session.cancel. Addressed continuable children
  instead need subagent.prompt/subagent.interrupt; one-shot children must honor the
  official read-only semantics. Its mux subscription behavior also needs checking.
  Public openSubagent intent from Home remains distinct from marked public open.

### Addressed continuation RPCs and confirmed limits (2026-09-12)

- Added exact `subagent.prompt` and `subagent.interrupt` client RPCs carrying
  parent, child and continuable mode. Prompt returns the official opaque string
  MessageId and carries optional browser timezone and AbortSignal; it does not
  use root session creation, model selection or ordinary prompt/stop methods.
- Checked actual rc.2 Session.prompt/cancel and API declarations: one-shot children
  are read-only and uncancellable through this interface; child image prompts are
  rejected by the official client. Added the same defensive checks and recorded
  these version-specific limitations in the assessment table.
- All 14 DshApiClient tests and app-runtime typecheck passed, including exact
  wire envelopes/receipts and no-RPC checks for one-shot or image input.
  These are RPC primitives only. Chat engine dispatch, mux subscription readiness,
  UI controls and end-to-end Desktop verification are still outstanding.

### Chat engine child stop dispatch (2026-09-12)

- ProductShell now supplies a stable chat-client resolver that reads the latest
  native or official child address without recreating the chat engine on tab
  changes. Continuable child abort calls subagent.interrupt; it does not call
  ordinary session.cancel, create a session or require parent availability.
  One-shot and mismatched addresses cannot fall through to root cancellation.
- All 17 chat engine tests and app-runtime/shell typechecks passed. Existing
  ordinary cancellation remains covered. Desktop visual/runtime verification has
  not yet run for this group of child changes.
- Sending is still open. Host events.mux emits initial subscribed frames only for
  attached sessions, while a cold catalog child may attach during continuation.
  Reusing waitUntilSubscribed(child) before subagent.prompt can therefore deadlock.
  The send integration must establish mux readiness without requiring preexisting
  child attachment, and propagate unavailable-parent errors rather than waiting
  forever. Do not claim that current child prompt dispatch is complete.

### Child send dispatch and header-established mux (2026-09-12; carrier superseded below)

- Verified the pinned Host Fetch client's `readSse`/`onOpen` contract: headers and
  a readable response establish the mux before any attached-session frame exists.
  Added `openEvents` using that HTTP stream, retaining existing WebSocket events
  for ordinary sessions. Its iterator can close an unread stream after a rejected
  prompt, handles split UTF-8/frame boundaries and propagates HTTP/stream errors.
- Addressed sends now establish this mux then call subagent.prompt; they do not
  run workspace resolution, session.create, model selection or ordinary prompt.
  One-shot and mismatched addresses reject before opening a stream. Parent errors
  propagate through the existing chat error event and close the stream immediately.
- All 37 client/engine tests passed. Cases include an empty mux, unread cleanup,
  split UTF-8 frames, HTTP failure, cold-child send ordering without a subscribed
  frame, unavailable parent, and unchanged ordinary conversation behavior.
- Desktop runtime endpoint availability, actual parent/child fixture continuation,
  read-only controls, explicit openSubagent-from-Home and full renderer verification
  remain open. This is not an end-to-end compatibility completion claim.

### Correct browser carrier after Desktop verification (2026-09-12)

- The first child build passed, but Desktop HTTP testing exposed two mismatches:
  the existing unary fetch IPC buffers whole bodies, and a native HTTP mux request
  received 403. The official Fetch carrier is not the browser connection carrier.
- Rechecked installed WebApiClient.readWebSocket and Host WebSocketDownlinks:
  the browser carrier uses socket `open` as its stream-established signal. Replaced
  the temporary SSE implementation with this exact readiness boundary. All native
  HTTP mux and CORS changes were removed; ordinary transport/security stays intact.
- `openEvents` starts the existing WebSocket iterator, waits for socket readiness,
  preserves its prefetched first frame, and closes even when a prompt fails before
  consuming frames. Failure/cancellation before opening reject and release resources.
- All 38 client/engine tests and shell typecheck passed. Production Desktop build
  `/tmp/amiba-child-websocket-build.log` completed successfully. Full Desktop
  `--compat --reopen-prose` smoke passed (`/tmp/amiba-child-websocket-smoke.log`),
  including actual WebSocket readiness and existing settings, ZIP, view, file,
  Markdown replacement, reload, directory, HMR and detach checks. Previous HTTP
  smoke failed and is not counted as verification.
- These results verify the corrected carrier and regressions. Actual durable
  parent/child navigation and continuation fixtures, read-only UI controls and
  public openSubagent-from-Home remain to be completed and tested.

### Real catalog-child Desktop navigation (2026-09-12)

- Added opt-in `--child-navigation` to the installed-plugin Desktop smoke.
  The temporary Host fixture creates a real session with parentSession/origin
  metadata and an in-turn v2 subagent/descriptor, then appends its own transcript.
  The fixture explicitly injects sessions; ordinary root fixture tracking ignores
  child creation so parent test state is not replaced.
- Initial fixture attempts exposed missing service injection and missing descriptor
  identity. Actual catalog projection requires the descriptor, not just origin.
  Neither failed attempt is counted as successful navigation verification.
- Full `--compat --reopen-prose --child-navigation` passed against the built
  Desktop (`/tmp/amiba-child-navigation-descriptor-smoke.log`). It verifies real
  catalog discovery, public openSubagent from an active parent, child-only transcript,
  exact retained parent address, parent return, child reopen and all existing
  compatibility regression checks. No production UI or style changes in this step.
- This fixture verifies persisted event reading, not actual model execution.
  Home-origin openSubagent intent, read-only controls, cold child reload and real
  continuation remain open.

### Home-origin explicit subagent navigation (2026-09-12)

- Extended the pinned runtime's existing navigation-intent patch to public
  openSubagent. It marks the child before synchronous selection notification,
  and restores the previous marker if catalog validation throws. Startup/restore
  selection remains unmarked and therefore retains Amiba's Home behavior.
- All 23 bridge tests and shell typecheck passed. The added test executes the
  actual installed patched method against the bridge, covering Home forwarding
  with its retained parent address and rollback on selection failure.
- Updated --child-navigation Desktop smoke with clear-to-Home then public
  openSubagent and parent return. Production build passed
  (`/tmp/amiba-child-home-build.log`), including managed patch-cache invalidation
  and locked dependency installation. Full --compat --reopen-prose
  --child-navigation passed (`/tmp/amiba-child-home-smoke.log`), including the
  real Home-origin child open and existing compatibility regression checks.
  Patch installation skipped lifecycle scripts and updated the lockfile patch hash.
  Read-only controls, cold child reload and actual continuation remain open.

### One-shot child composer policy (2026-09-13)

- ChatSurface derives read-only state only from a retained one-shot address and
  passes it to the existing Composer disabled state. No CSS/layout replacement.
  The queue's send, send-now, drain and stop entry points refuse read-only actions;
  the turn runner also returns the supplied draft instead of dispatching it.
- Queue tests verify that read-only attempts preserve draft and queued text, do
  not call the runner or engine abort, and resume existing sending after returning
  to an editable session. Shell typecheck passed.
- Extended real-child smoke with visible editor contenteditable=false, screenshot,
  parent return restoring contenteditable=true and optional --child-reload verifying
  the child after a complete renderer restart. Initial build passed, but the first
  Desktop smoke failed its read-only assertion: RichComposerEditor only used
  disabled in Lexical's initialConfig, which does not react to later prop changes.
- Added an in-context editable-state synchronizer without remounting Lexical;
  disabled editors no longer forward paste or register submission chords. The
  regression test verifies both transitions on the same editor/DOM with its draft
  retained. All 19 editor/composer/queue tests and shell typecheck passed.
- Production rebuild passed (`/tmp/amiba-child-editor-state-build.log`). Full
  --compat --reopen-prose --child-navigation --child-reload passed
  (`/tmp/amiba-child-editor-state-smoke.log`): one-shot editor is read-only,
  parent editor becomes editable, and child transcript/address/read-only state
  survive a complete renderer reload. The child screenshot was visually reviewed;
  original layout and native disabled styling remain. This is renderer restart,
  not cold Host/Agent recovery. Actual continuation remains open.

### 子会话地址在列表同步期间的保留（2026-09-13）

- 先用回归用例复现两种地址丢失：列表刷新读取旧 sidecar 后，用户才打开目录子会话；以及另一窗口广播含同一子会话但不含地址的旧列表。原实现两个用例均失败。
- 外部列表合并现在保留已确认的子会话地址及直接父 ID，仍接受标题等字段更新。显式传入的新地址或不同父 ID 不会被本地旧地址覆盖。此修改不涉及界面、样式或正常根会话运输。
- 37 个会话存储/平台适配测试与 app-runtime 类型检查通过；覆盖刷新竞态后切换回子会话仍使用 subagent.history、旧广播保留地址、显式新元数据覆盖旧值。此项为状态层验证，不替代实际可续聊执行及冷 Host 恢复验证。

### 可续聊子会话真实执行和停止（2026-09-13）

- 新增 `continuable-child-fixture.mjs`，由桌面 smoke 的 `--child-continuation` 加载。仅在独立临时配置中注册本地 LlmAdapter；父子 Agent 都显式指定该测试提供器。通过官方 `agents.create`、`subagents.startContinuable` 创建会话，模型分块交给实际 Agent loop 写入历史和发送事件，不手工伪造该子会话的回复或完成事件。
- 从真实目录打开后，通过 CDP 键盘输入驱动 Amiba 原输入框提交 `COMPAT_NATIVE_FOLLOWUP`；界面收到对应官方执行回复。再提交持续等待的模型请求，点击原“停止生成”按钮，验证模型 AbortSignal 实际收到取消，并且原输入框退出忙碌状态。
- 测试父会话也使用本地模型处理官方子会话结算通知，避免后台通知意外调用外部服务。仍保留官方时间上下文；测试适配器只提取明确的测试输入标记，不将最后一条系统注入上下文误当用户输入。
- 此次测试复用已有桌面构建（实际执行相关产品源码未改）；新增内容仅为测试夹具和覆盖。冷 Host 重启恢复、图片输入限制的完整 UI 仍未由此证明。

### 命令图片提交接入（2026-09-13）

- 原桥接固定将空图片列表传给 `CommandClaim.submit`。现在 Amiba 原输入器捕获本次附件，通过现有 Host staging 读取原始字节，验证身份、大小、类型，按官方 `SubmitImageAttachment` 传递 mediaType/data/name；不把缩略图或暂存 ID 冒充图片内容。
- `claim.images` 未开启、上传未完成、非图片附件或读取失败时，在现有命令提示区域报告原因并保留草稿和附件。成功仅移除本次捕获的附件；重复点击不重复提交，提交期间修改的文字或新增附件不被清空，跨会话完成也不清空新会话草稿。正常发送、输入器布局和 CSS 未替换。
- UI 文本时间线的本地类型此前漏掉已存在的来源字段，导致 MessageChrome 测试类型检查失败；改为复用核心 text 分支类型，运行行为不变。
- 原图序列化 8 项、输入管线 14 项、消息展示 49 项、桥接 11 项测试通过（82 项）；UI/Shell 类型检查及完整 Desktop 构建通过。
- `/tmp/amiba-command-images-smoke2.log` 退出 0：`--compat --command-images --child-continuation --child-navigation --child-reload` 从原隐藏文件输入上传真实 PNG，通过官方 source 的命令判定和原发送按钮执行，断言插件收到的完整 base64、文件名及 MIME 与上传文件相同，成功后附件与草稿被消费。同轮子会话发送、停止、只读、重载及现有完整兼容回归通过。首次 smoke 因未等待附件上传完成点击了禁用按钮；已补等待，不将该失败算作成功证据。
- 这只补齐命令携带图片的提交路径，尚不表示完整 `useInput/inputActions` 的草稿、引用和附件 ID 服务已接入。

### 官方提交判定的附件数量（2026-09-13）

- 实际 rc.2 的 `InputTriggerController.adjudicate(line, signal, envelope)` 将第三参数直接传给每个 source 的 `matchEnter`。官方 commands source 会读取 `envelope.images`，且不会补默认值。此前 Amiba 的结构类型和调用都遗漏该必需参数。
- 先复现 0 张及 2 张图片的两项失败，再补充真实图片数量；普通文件不计入该数量。公共结构类型直接引用官方 source 回调参数，避免再次把必需字段漏掉。24 项相关测试与 UI 类型检查通过。
- 完整输入服务的后续约束：官方 `SessionProvideChannel` 拒绝同名 hook/prop 的重复提供者；现有 `input` / `inputActions` 来自 ui-conversation 的 InputHub。完整桥接必须接到该唯一提供者及真实编辑器状态，不能叠加第二套同名提供者或只提供空快照。
- 完整 Desktop 构建通过；`/tmp/amiba-input-envelope-smoke.log` 的 `--compat --command-images` 退出 0，真实官方 source 在 `matchEnter` 阶段收到 `{images:1}`，随后命令仍收到原图字节。既有完整兼容 smoke 同轮通过，未修改布局或 CSS。

### 输入扩展异步提交的取消与过期结果（2026-09-13）

- 先复现修改草稿、切换会话和卸载输入器后的三个失败用例：旧 adjudication 的 AbortSignal 未取消，返回 undefined 后仍可能走普通发送，晚返回的 claim 也可能进入新的草稿。
- 原输入器现在为判定与引用展开持有同一个提交 AbortController。草稿、会话、禁用状态或附件改变以及卸载时，取消旧提交并释放该提交的锁；旧结果、异常和 finally 均不会覆盖或解锁后续新提交。已经进入命令执行的提交仍按原成功/失败结算规则处理。
- `expandMentionsAsync` 接受可选外部 signal 并传给官方 reference codec；开始前与展开后检查取消，拒绝忽略取消的插件晚返回结果。未传 signal 的既有调用仍可用；普通资源解析行为保留。
- 32 项输入管线、原图序列化和引用展开测试，以及 UI 类型检查通过。包括旧 claim 在新提交等待期间返回仍不接管新草稿、旧 finally 不解锁新提交、已取消的请求不调用 codec。此次是状态和接口回归验证，未重复完整桌面构建/烟测；未修改 CSS 或布局。

### 输入草稿与引用的独立投影（2026-09-13）

- 实际 npm rc.2 的公开 InputState 用完整 `@label` 和 offset/length 表示引用；现有 Amiba 触发菜单以单个 U+FFFC 芯片计算 span。为保留既有菜单及光标行为，新增独立 `InputDraftProjection`，不直接改变 `$scanDraft` 的坐标约定。
- 从真实 Lexical 树读取完整草稿和官方引用表：同名引用按节点身份分配不同稳定 occurrenceId；保留 source/ref/label/clipboardText，UTF-16 偏移计入中文、Emoji、段落间隔。没有官方 owner 的原生/旧芯片保留原持久化 token，不伪造引用来源。未改变内容时复用冻结快照，后续编辑不会修改已交出的快照。
- `createTriggerEditorOps.readInputDraft` 与 Shell 的 `inputDraftFor(sessionId)` 已连通真实编辑器；没有编辑器时返回 undefined，旧绑定卸载不移除新绑定。菜单 revision 现在也识别完整持久化内容变化，避免引用身份/标签改变而占位字符串未变时漏更新。
- 39 项编辑器/输入管线及 12 项桥接测试通过；UI/Shell 类型检查通过。仅新增读取投影和绑定入口，**尚未**替代官方 useInput/inputActions 提供者，也尚不包含图片 ID、阶段、队列或完整公共写入桥接。该投影是下一步单一输入提供者适配的数据来源，不能据此宣称完整输入服务已支持。此步未改 CSS 或布局，未重复桌面烟测。

### 实时输入草稿订阅（2026-09-13）

- 在真实编辑器读取投影之上增加 `subscribeInputDraft` 和 Shell `inputDraftSource(sessionId)`：每个会话拥有稳定 source，绑定、编辑、替换与卸载通知相应订阅者；无编辑器时 snapshot 为 undefined。没有重复注册官方 input 提供者。
- 公开 draftRev 现在按完整草稿/引用投影独立递增，不依赖触发菜单更新监听器的执行顺序。绑定期间每次编辑先刷新投影，再通知监听者；即使中途没有读取、编辑后恢复原文，版本仍递增，避免旧 span 被误当作当前操作。
- 每次编辑器绑定拥有独立身份；旧绑定的事件、bail 操作与清理都不能作用于替换后的编辑器，即使两次绑定复用同一个 ops 对象。订阅清理幂等，旧清理不会移除后来注册的监听者。
- 41 项编辑器/输入管线和 16 项桥接测试，以及 UI/Shell 类型检查通过。此步未改布局或 CSS、未重复桌面构建。公开官方 useInput/inputActions 提供者、写入操作、图片 ID 和提交阶段仍待接入；这里完成的是其所需的实时数据源与生命周期。

### 公开草稿写入到原编辑器（2026-09-13）

- 新增按完整显示文本写入的 `setInputDraft`，从 Shell 当前会话绑定路由到真实 Lexical 编辑器。通过前后公共草稿差异定位最小修改，并转换到原菜单坐标；未受影响的引用节点及 occurrenceId 保留，编辑穿过引用内部时只将该引用转成文字。没有重建整套输入器或替换样式。
- 可选 expectedRevision 在修改前比对公开草稿版本；过期、无编辑器、只读或提交判定冻结时拒绝写入。返回值以实际公共草稿是否变成目标文本判断，不以底层占位字符串变化冒充成功。
- 先复现空段落边界失败，再为已有坐标解析补上记录在 scan.spans 中的元素边界；覆盖完全空段落、开头/结尾空段落及段落分隔符局部替换。
- 32 项编辑器、20 项输入管线和 17 项桥接测试通过（69 项）；UI/Shell 类型检查通过。覆盖同名引用稳定身份、中文/Emoji、只修改一个引用、无效版本、只读/冻结、跨会话路由，以及原占位字符串不变但实际引用已改变的返回值。未重复桌面构建或烟测。
- 这是完整输入服务的原编辑器写入端，尚未连接官方唯一 `inputActions` 提供者；提交动作、阶段、附件 ID 及其他剩余兼容项仍需完成。

### 原输入器的公开提交阶段（2026-09-13）

- 草稿订阅现在合并真实 `plain` / `claimed` / `adjudicating` / `submitting` 阶段及命令描述。CommandClaimStore 在已有进入命令、退出命令及真实提交步骤上发布状态；快照只暴露 token/hint/images，不暴露 submit 函数。提交中保留本次捕获的命令描述，即使草稿修改已退出实时命令模式。
- 阶段变化不增加文本 draftRev；未变化快照保持同一引用。判定和提交期间拒绝公开草稿写入，已有原输入操作保持原路径。
- 命令状态按会话建立；每次提交拥有独立身份。切换会话不再让旧命令阻塞新会话，旧完成回调不解除新提交的锁、不清空其草稿。原文字/图片发送仍经现有路由。
- 63 项编辑器/输入管线/图片序列化与 17 项桥接测试通过，UI/Shell 类型检查通过。新增真实桌面 `--input-state` 验证读取、订阅、写入与过期版本拒绝，并与图片命令一起核对四种公开阶段。
- 本步骤仍未替代官方唯一 input/inputActions 提供者；图片 ID、队列、完整官方提交动作桥接等仍在原目标范围内。
- `/tmp/amiba-input-phase-build.log` 完整 Desktop 构建退出 0；`/tmp/amiba-input-phase-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。真实桌面读取/订阅/写入及过期版本拒绝通过，原图片命令经订阅实际发布四个阶段；子会话发送、停止、只读、重载和既有完整兼容回归同轮通过。覆盖了前几步未重复桌面构建的输入投影、写入及异步生命周期组合。

### 扩展提交入口连接原发送路径（2026-09-13）

- 新增 `bindSubmit` / `submitInput(sessionId)`，将会话地址映射到当前 Composer 的真实提交回调。回调经过原命令路由、提交判定和引用展开，再调用原 onSubmit；不会另起一套发送器，也不会将空草稿提交转成 Stop。
- 原发送条件抽成可对指定草稿求值的函数，ChatSurface 原按钮与扩展提交共同使用。扩展调用读取 Lexical 最新的持久化文本，覆盖“同一次事件先 setInputDraft 再 submit”而 React 属性尚未提交的情况；异步取消按本次捕获草稿校验，避免把这次正常属性同步误当用户修改。
- 返回 true 仅表示进入原输入器提交判定，不表示 Host 已接受或模型已完成。只读、附件忙碌、现有发送条件不满足、提交已在进行及错误/过期会话回调均返回 false。最新绑定卸载后不可再提交，旧绑定清理不覆盖新绑定。
- 60 项编辑器/输入管线和 18 项桥接测试、UI/Shell 类型检查通过。新增用例在同一 act 中写入并提交，确认只发送一次最新内容；原异步取消与命令生命周期回归通过。此步未改样式或布局，未重复完整桌面构建。
- 这是原编辑器提交端，仍需接到官方 inputActions 的唯一提供者；附件 ID、图片操作及其他全量兼容项仍未完成。

### 草稿附件契约复核（2026-09-13）

- 直接复核实际 npm rc.2 的 `dsh-client-ui-conversation/lib/client.js` 及 `contract/slots.d.ts`：`conversation.input.attachments` 已由 composer.bar 注册，并非只有新版才存在。已修正评估表第 15 行，后续以实际包为准。
- 官方 ComposerAttachment 持有 browser File、DraftAttachmentId 和 previewUrl；Conversation.createDraftImages 先验证整个批次 MIME，再注册图片；draftImages 保留请求顺序并跳过已释放 ID，serializeDraftImages 对缺失 ID 拒绝。releaseDraftImage 删除注册项并释放 object URL。
- 适配必须保留浏览器草稿与 Host 暂存附件的独立身份，并接通成功消费、移除和会话释放；不能把 Host staging ID 填入官方 imageIds，也不能以缩略图代替原 File。此处为已确认的接入约束，尚未完成附件桥接。

### 扩展提交入口的真实桌面验证（2026-09-13）

- `--input-state` 新增通过实际 Shell composerInputs 调用的桌面用例：同一次浏览器事件先写入再提交，首次进入官方命令判定；再次同步写入中文/Emoji 参数并提交，官方 claim 收到最新文本。两阶段均断言紧接的重复提交被拒绝。
- 命令夹具保持待完成 Promise，核对真实 submitting 阶段后才释放；成功后原编辑器清空并回到 plain。空草稿以及未绑定会话的提交均拒绝。夹具只注册测试命令，不调用外部模型。
- `/tmp/amiba-input-submit-desktop-build.log` 完整 Desktop 构建退出 0；`/tmp/amiba-input-submit-desktop-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。新增入口用例、原图命令、全部四种输入阶段、真实子会话执行与取消、只读/重载、现有设置/目录/Markdown/插件生命周期回归同轮通过。
- 覆盖前一步产品提交入口改动；本步没有改产品样式、布局或发送行为。官方唯一 input/inputActions 提供者、草稿附件映射和剩余全量兼容项仍待完成。

### 原生附件进入官方草稿图片注册表（2026-09-13）

- 原 ChatSurface 的附件入口现在将实际浏览器 File 交给 composerImages.createDraftImages，并在 hook 内以原 UI 芯片 ID 保存注册描述；官方 DraftAttachmentId 与 Host staging attachmentId 分开。原附件展示、上传、命令原图读取和普通发送仍走原路径。
- 注册资源随芯片移除、直接清空附件状态、上传失败或输入器卸载释放；上传中移除仍删除晚到的 Host 暂存文件；等待会话 ID 时卸载不会事后注册浏览器资源。释放闭包绑定创建该图片的服务，服务替换后也不向新实例释放旧图片，重复释放无副作用。
- 实际桌面未创建官方 ConversationController，仅注册官方无界面节点；首次桌面用例因等待不存在的 conversation 服务而失败。已改为独立 composerImages 注册表，按实际 rc.2 的图片方法契约提供创建、顺序读取、原图序列化及释放，不能据此宣称完整 conversation 服务已存在。官方不接受的原生图片格式保留原上传能力。注册描述仍持有原 File，绝不以缩略图代替。
- 5 项附件生命周期、26 项原输入管线和 20 项 Shell 桥接测试通过（51 项），UI/Shell 类型检查通过。完整官方 input/imageIds 提供者、官方草稿向原输入器添加及队列恢复仍未由此完成。

- 注册表新增整批 MIME 验证、URL 分配中途失败回滚、原始字节与顺序验证、已释放 ID 序列化拒绝和 dispose 后拒绝创建测试；3 项通过，合计相关测试 54 项。前述“官方唯一 input 提供者”是官方完整 ui-conversation 启动后的约束，不能误写成 Amiba 当前已存在该提供者；当前仅有原生 composerInputs 桥接，后续需建立真实 provider。
- 修正后的 `/tmp/amiba-draft-image-registry-desktop-build.log` 完整构建退出 0，`/tmp/amiba-draft-image-registry-desktop-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。真实 PNG 经原文件输入上传，确认兼容注册表持有原 File、正确大小和 blob 预览，读取 File 全部字节与上传数据一致；原命令成功后注册项消失。既有图片命令、输入提交、子会话执行与停止、只读/重载及完整兼容回归同轮通过。

### 扩展草稿图片进入原附件流程（2026-09-13）

- 新增会话绑定的 inputImagesFor/addInputImages/removeInputImage，通过原 Composer 和附件 hook 操作已有卡片及上传函数。扩展创建的 File 和 DraftAttachmentId 保留，不再重复注册；Host staging ID 仍独立。
- 添加前核对全部 ID 均能按请求顺序解析；缺失 ID、没有输入器、只读、提交判定/命令执行中、上传或手动附件忙碌时拒绝，不释放调用方未被接受的图片。空批次遵守相同接入条件。旧绑定卸载不移除新绑定，过期会话回调不操作新会话。
- 浏览器注册的原生持有者按注册表实例和草稿 ID 计数；重复 ID 或不同会话共享图片时，最后一个持有者释放后才释放预览。绑定不改变原文件类型支持。
- 扩展附件在等待 session ID 前建立原生待上传芯片，允许同一次操作立即移除；lookup 失败或输入器卸载释放资源。上传计数同步更新，扩展添加后立即 submit 不会因 React 尚未刷新 busy 属性而发送空附件；并发原生上传在全部结束前保持 busy。
- 8 项附件、28 项输入管线、23 项桥接及 3 项注册表测试通过（62 项），UI/Shell 类型检查通过。新增冻结判定测试使用斜杠草稿触发实际 adjudication；最初普通文字未触发该回调，已修正测试输入。
- 这是内部会话附件桥接，尚未注册完整官方 input/inputActions 提供者。同步完整 imageIds 快照、pruneImages、队列恢复及其他全量兼容项仍待完成。
- `/tmp/amiba-input-images-desktop-build.log` 完整 Desktop 构建退出 0；`/tmp/amiba-input-images-desktop-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。扩展用浏览器 File 创建草稿，通过 addInputImages 进入原卡片；混入缺失 ID 整批拒绝且保留原草稿；添加后立即 submit 返回 false，上传完成后原命令收到正确文件名和全部 base64 原图，成功消费对应草稿。立即添加后移除验证没有残留卡片及浏览器注册项。原输入提交、原生图片上传、子会话执行/停止/只读/重载及既有完整兼容回归同轮通过。

### 实时图片草稿快照与失效引用清理（2026-09-13）

- 新增 inputImagesSource 会话数据源：稳定 source、冻结数组快照、未变化时复用快照；添加/移除/清理和绑定/解绑均可观察。原 Composer 保持一次图片绑定，通过原附件 hook 的订阅推送变化，附件更新不再临时解绑成 undefined。旧编辑器通知和旧清理不作用于替换后的绑定，清理幂等。
- 原附件状态增加同步引用，由统一 setAttachments 按最新列表应用函数更新一次，再驱动 React 展示；图片快照和通知在操作内更新。扩展在同次调用 addInputImages 后可立即读取原图片 ID，remove/prune 后可立即读到新列表。上传进度变化不创建无意义的新图片快照。
- 新增 pruneInputImages/pruneDraftImages，按可用草稿 ID 清理对应原生芯片，保持非注册图片及普通文件；按官方契约，维护性 prune 不受提交/上传 admission 锁阻止。成功上传后只有暂存元数据变化，不重复发图片列表通知。
- 卸载时清空同步附件引用，晚到的上传结果因此进入既有“芯片已移除”路径并删除 Host 暂存文件；不再使已卸载输入器持有晚到的文件。浏览器注册释放规则和共享持有计数保持。
- 10 项附件、28 项输入管线、25 项桥接及 3 项注册表测试通过（66 项），UI/Shell 类型检查通过。覆盖同次添加/清理同步读取、旧快照不可变、保留普通文件、忙碌期间 prune、元数据变化不重复通知、晚上传清理及绑定替换隔离。
- 尚未将文字/图片/真实 Host 队列合成官方 InputState 并注册 input/inputActions 提供者；队列恢复及其他剩余兼容项仍在完整目标范围内。
- `/tmp/amiba-image-source-desktop-build.log` 完整 Desktop 构建退出 0；`/tmp/amiba-image-source-desktop-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。真实输入器添加图片的同一次调用立即读到 ID；订阅捕获添加和 prune 后的列表，重复读取复用快照且过程中没有暂时解绑的 undefined；上传忙碌中先保留一张再清空，待上传全部结束仍为空，注册资源均已释放。既有原生/扩展图片命令、输入提交、子会话及完整兼容回归同轮通过。

### 原输入状态与真实 Host 队列合成（2026-09-13）

- 从实际官方 conversation.input.left owner 推导 ConversationInputState 类型，合并真实 Lexical 草稿/引用/阶段、同步浏览器 imageIds 和 SessionFace.getSnapshot().queue。严格使用 Host 收件队列；不将本地待发送队列的 ID 或内容冒充官方队列。
- inputStateSource 按会话缓存稳定数据源。草稿、图片 ID 序列和队列引用未变时复用冻结快照；仅阶段或图片变化不增加文字 draftRev；图片 ID 序列未变时复用其数组。缺少实际编辑器、附件绑定或 SessionFace 时返回 undefined，不合成伪空完整状态。
- 订阅同时连接草稿、图片和真实会话队列；会话服务更新时重绑队列，旧 owner 的事件不再通知。即使同一 owner 对象经历断开后重新接入，旧订阅回调也被独立绑定标识隔离；取消订阅幂等。
- 4 项合成状态、25 项输入桥接和 3 项图片注册表测试通过（32 项），UI/Shell 类型检查通过。测试使用有完整 id/messageId/placement/content/preview/text 的 Host 队列行，核对其原对象身份和更新通知。
- 此步骤为真实 InputZone/公共输入提供者的数据来源，尚未注册 useInput/inputActions 或输入区域扩展入口；未绑定会话的动作语义和队列恢复仍需处理，不能据此宣称完整输入服务已完成。已清理 SDK 注释中过时的单占位引用假设。
- `/tmp/amiba-combined-input-desktop-build.log` 完整 Desktop 构建退出 0；`/tmp/amiba-combined-input-desktop-smoke.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。真实桌面合成状态读取到原草稿、扩展添加同次调用内的 imageIds 及全部四种输入阶段；queue 与实际 SessionFace 当前队列保持同一引用，重复读取复用快照。既有图片、提交、子会话与完整兼容回归同轮通过。此桌面用例验证真实队列来源，非空队列更新和重新绑定由前述状态测试覆盖，尚不代表完整队列编辑/恢复链路已验证。

### 四个官方输入区域的真实接入（2026-09-13）

- 声明并派发 conversation.input.dock、conversation.composer.dock、conversation.input.left、conversation.input.right，均使用实际 rc.2 的 list/session/InputZone 契约。InputRegion 订阅真实 ConversationSnapshot 与合成原输入状态，只在两个 owner 都存在时调用扩展；会话替换后旧源不再更新区域。
- 位置遵循官方契约：input.dock 在卡片上方，composer.dock 在下方，left 在原工具行已有控制项后，right 在模型控件后、发送按钮前。通过原 FullScreenChatView/ChatSurface/Composer 传递；裸 React 节点无额外盒子或 CSS，空入口不增加 DOM、间距或样式。原输入器和已有控制项保留。
- 6 项 Composer 入口/空节点测试、28 项输入管线、2 项区域 owner/订阅测试、4 项合成状态测试通过（40 项）；UI/Shell 类型检查通过。
- 旧 accessory 断言要求辅助内容在卡片外，使用 HEAD 原 Composer 和原测试独立复跑同样失败（/tmp/amiba-input-regions-baseline-test.log）。现有产品已将其放在卡片内，因此修正过时断言并保持实际布局，不为测试移动原组件。临时基线文件已清理。
- 这些区域由 owner 接收真实 session/input，无需伪造 useInput。依赖尚未提供的 useInput/inputActions、完整 conversation 服务或其他私有依赖的扩展仍需后续适配；本步骤不宣称全部组件可直接使用。
- `/tmp/amiba-input-regions-desktop-build.log` 完整构建退出 0；`/tmp/amiba-input-regions-desktop-smoke4.log` 的 `--compat --input-state --command-images --child-continuation --child-navigation --child-reload` 退出 0。四个真实插件入口传入正确 sessionId、真实 Host queue 和原草稿，文字/图片变化更新 owner；位置符合上下 dock 和工具行左右区。卸载保留同一个原编辑器节点，卡片类名及宽高恢复至挂载前。截图 amiba-input-regions.png 已查看，现有操作保持可见。
- 首次桌面夹具将 React 打入插件包导致 process 未定义；改为 external 复用运行时 React。随后位置断言错误地要求插件元素直接邻接原控件，实际运行时会包装插件元素；截图和 DOM 确认位置正确后，按区域分支与原卡片/发送按钮的相对顺序核对，未更改产品代码绕过该断言。前三次失败不计为通过证据。


### 官方标准 inputActions 提供者（2026-09-13）

- 通过真实 `sessions.provide` 注册 `inputActions`，按会话缓存动作对象。操作每次查找该会话当前绑定的原输入器；卸载旧编辑器不会移除替代编辑器，也不会改到其他会话。
- `setDraft` 使用 Lexical 的同一差分写入路径。官方 rc.2 的 `draft-changed` 不拒绝 adjudicating/submitting，因此单独增加用户编辑操作；原菜单/CAS 写入的锁定规则保持不变。真实只读输入器仍拒绝写入。
- 图片添加、移除、清理及提交调用现有桥接；`submit()` 保留官方 void 契约，不能把内部准入布尔值解释为 Host 已接收。
- 未挂载输入器的草稿写入明确报错；这仍是与官方常驻会话草稿的差异。当前未注册 `useInput`，不制造空状态来伪装完整输入服务。
- 验证：Shell provider/bridge 28 项、UI editor/pipeline 64 项通过；Shell 与 UI 类型检查通过。完整 Desktop 构建通过。真实插件经标准属性拿到 inputActions，并完成写入、提交以及旧命令成功后保留新草稿；图片、子会话续聊/停止、导航及 renderer 重载回归通过，输入区域卸载后原编辑器身份和卡片尺寸保持。
- 日志：`/tmp/amiba-input-actions-tests.log`、`/tmp/amiba-input-actions-ui-tests.log`、`/tmp/amiba-input-actions-desktop-build.log`、`/tmp/amiba-input-actions-desktop-smoke.log`。


### 官方附件展示入口（2026-09-13）

- 声明并实际渲染 `conversation.input.attachments`（single/session-maybe），传递真实浏览器附件 File、DraftAttachmentId 和 previewUrl。原附件条、文件选择、编辑器及样式保留。
- owner 的图片添加和移除回调使用原附件 hook。每次操作检查当前会话身份、只读、命令/引用处理锁和上传状态，旧会话回调不能修改新会话。空插件入口不添加包装元素。
- 未提供没有根据的数量/大小限制；官方可选 dropLimits 保持缺省。普通文件仍通过原附件入口操作。
- UI 附件入口与注册链路 18 项测试、Shell/UI 类型检查及完整 Desktop 构建通过。真实插件以标准 single 槽优先级覆盖官方默认组件，添加/读取/移除原始图片通过；卸载后恢复默认组件。默认官方文档 drop 与原输入框 drop 同时存在时只暂存一张图，同步上传门禁阻止重复添加。子会话续聊/停止、导航及 renderer 重载回归通过。
- 首次桌面测试发现已有官方附件组件占用 priority 0，按框架规则将测试插件改为 priority -100；未修改框架冲突规则。最终日志 `/tmp/amiba-attachment-seat-smoke3.log`，截图 `amiba-official-attachment-seat.png` 已查看，原附件条和输入器保留。插件新增的预览区域属于附加展示。
- useInput 的完整提供仍需按会话拥有草稿生命周期，不能用组件未挂载时的空值假装常驻输入状态。
