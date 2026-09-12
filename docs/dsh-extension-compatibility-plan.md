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
