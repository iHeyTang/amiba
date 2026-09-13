# DSH extension compatibility implementation

Base: `main` at `3cbcaaa2dbf4b9036c43c5e0a175bcdcccaefecb`.
Initial branch: `feat/dsh-extension-compat-isolated` (merged).
Continued from main `99e8f93` on `feat/dsh-extension-compat-next` in the same isolated worktree.
Main and the other task's personal menu, external-message and update changes are preserved.

## Required invariants

### Addressed asynchronous message updates

`SessionsStore.updateActiveMessagesFor` checks the actual selected session before evaluating an updater. Callbacks for another session or Home do not run; accepted updates use the current message array and preserve the original persistence behavior. Native asynchronous attachment badges now use this addressed update, skip absent user messages, and update the matching in-flight user cache so recovery of a missing local user bubble can include the completed badges. This prevents delayed badge preparation from touching another session's messages or recalculating the sending session's metadata using another conversation.

Validation: 25 session-store tests passed, including two new target-isolation/return-to-target cases; runtime and UI type checks, full desktop build and the complete compatibility smoke passed. The smoke verifies existing flows, not an artificially delayed thumbnail race. Evidence: `/tmp/amiba-addressed-messages-tests.log`, `/tmp/amiba-addressed-messages-runtime-types.log`, `/tmp/amiba-addressed-messages-ui-types.log`, `/tmp/amiba-addressed-messages-build.log`, `/tmp/amiba-addressed-messages-smoke.log`. Full offscreen submission remains pending.

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


### 输入状态的会话组装时序与生命周期（2026-09-13）

- 官方 InputHub 的 shellFor(binding) 明确在会话作用域可按 ID 查询之前执行。原组合输入状态只通过 sessions.binding(id) 查队列，在标准提供者初始化期间可能缺少会话对象。
- inputActions 提供者现在使用 resolve(binding) 直接获得的真实 session，通过会话 effect 绑定到输入桥。组合输入状态优先使用这份对象；旧版单独使用桥接的调用方仍保留按 ID 查找的回退。
- 按会话/作用域对象去重复绑定。替换时先绑定新对象，再清理旧 effect，避免瞬时 undefined；每个绑定的清理令牌只可移除自己。移除插件提供者或作用域销毁时释放订阅，不留下旧队列监听。
- 新增测试覆盖首次 materialization 尚无法按 ID 查询、非空真实队列身份、重复 resolve、对象替换、不出现瞬时空状态、过期清理、队列变化与 provider.dispose；相关 Shell 测试共 33 项通过。
- 本项未引入离屏草稿或 useInput 空值替身。完整常驻输入状态仍需处理 native draft、引用、图片及提交生命周期，未据此宣称完整输入兼容。

- 本项验证：Shell 类型检查、完整 Desktop 构建及真实桌面兼容测试通过。日志 `/tmp/amiba-input-session-owner-types2.log`、`/tmp/amiba-input-session-owner-tests.log`、`/tmp/amiba-input-session-owner-build.log`、`/tmp/amiba-input-session-owner-smoke.log`。


### 按命令名分派的官方命令结果入口（2026-09-13）

- 接入 `conversation.chat.commandview` keyed/session 槽，entryKey 使用原节点 name（缺失为官方规定的空串）。从真实 Chat order/nodes 读取可见命令，保持原 CommandNode 引用；manual-compaction 使用官方投影已经关联的数据，不凭邻近序号猜测压缩关联。
- 展示锚点仅用于 MessageTurns 的渲染，不写 session 消息存储，也不进入发送历史。按引擎 anchorSeq 定位到现有消息/工具展示组之间；保留工具折叠组整体，发生在组内的命令展示附加在组后，尚不提供拆开折叠过程的精确内部位置。
- 原历史转换已将 command/run、command/done 映射为命令输入和结果消息。因此只为当前 keyed 槽赢家生成展示锚点，并隐藏同一 commandId 的原结果展示，避免历史重载后重复；命令输入与存储数据保持。卸载或无注册时不生成锚点，恢复原生结果和样式。
- 消息 UI 52 项、命令投影 1 项测试通过；UI/Shell 类型检查通过。测试覆盖空入口无额外 DOM、独立命令、两轮会话之间的位置、原工具折叠组不变、原参数及明确压缩关联。

- 真实桌面已验证 Host 日志中的 command/run → command/done：插件收到原始参数、执行中状态、完成结果及真实 CommandNode 对象。整页 renderer 重载后覆盖原结果只显示一份，卸载恢复原生结果；输入、附件、子会话续聊/停止、导航及其他兼容回归通过。
- 日志：`/tmp/amiba-command-rows-ui-tests3.log`（52）、`/tmp/amiba-command-rows-tests.log`（1）、`/tmp/amiba-command-rows-types4.log`、`/tmp/amiba-command-rows-ui-types2.log`、`/tmp/amiba-command-rows-build2.log`、`/tmp/amiba-command-rows-smoke2.log`。`amiba-command-row.png` 截图已查看。


### 动态 Cordis 业务区域（2026-09-13）

- 真实桌面探针证实，官方动态运行器已可加载 Client 包，但 Amiba 的原生 cordis_run 语义卡片覆盖了官方 Run 卡片，缺少其子区域渲染位置。这是展示适配缺口，不是动态代码不能运行。
- 保留原生工具卡片及折叠行为，在其下方附加 `tool.view.cordis`。owner 使用真实结果 metadata 的 Plugin/Package/Run ID；entryKey 遵守官方 `${pluginId}.${packageId}` 规则。真实动态包仍通过官方 Guard 的 key:self 注册，不提供绕过 Guard 的入口。
- 使用官方 session 的工具结果树决定同一包的最新成功卡片，并与本页 loaded 列表精确匹配 activation。停止后撤销业务区；失败、过期、缺失元数据及无会话来源时不制造 owner。递归覆盖嵌套 tool result。
- 原工具视图 45 项加业务区 3 项测试通过，涵盖最新归属、失败/缺失数据、运行实例不符、停止更新及订阅清理。真实 Host 定义、Client 运行器加载、交互、元数据归属、停止及样式清理已通过桌面验证；未据此证明双端 handler RPC、版本升级或崩溃回退全部完成。

- 构建与类型检查通过。探针通过官方 define 创建包、startUserRun 加载、Guard key:self 注册，使用真实生成的 run identity 构造测试工具结果；不是生产模型自主触发 cordis_run 的测试。已查看 `amiba-cordis-business.png`，原生 Run module 卡片、折叠过程和输入器保留。
- 验证日志：`/tmp/amiba-cordis-business-types2.log`、`/tmp/amiba-cordis-business-tests.log`（48 项）、`/tmp/amiba-cordis-business-build.log`、`/tmp/amiba-cordis-business-smoke6.log`。早期探针失败分别暴露了测试脚本错误导入 React、未展开原折叠组、原卡片缺少子区域以及测试 ctx 未声明 remote 依赖；正式适配仅补充缺少的业务区域。

- 组合回归 `/tmp/amiba-cordis-business-smoke7.log` 通过，包含动态业务区、命令历史重载、标准输入动作、命令图片、子会话续聊/停止/导航/重载及此前兼容检查。


### 动态 Cordis 双端调用与版本切换验证（2026-09-13）

- 将业务区探针扩展为真实 Host + Client 双端包。Host 使用官方 harness.handle 注册带内部计数器的方法，Client 按钮通过 host.call 发送中文/Emoji 参数；计数和回传文本均来自 Host，未在 Client 模拟返回。
- 验证运行中错误 run ID 返回 stale-run；停止后原 ID 返回 plugin-not-running。同一 Package 重启获得新 run ID，旧 ID 被拒绝，新 Host 闭包计数重新从 1 开始；旧工具卡片不承载新 activation。
- 通过真实 define(existing Plugin) 创建第二个不可变 Package，使用 startUserRun(mode:update) 切换双端代码。新卡片显示 v2 界面，RPC 返回 Host-v2，只有一份业务组件；前一版本 run ID 返回 stale-run。历史工具记录保留。
- 组合 Desktop 回归通过，日志 `/tmp/amiba-cordis-rpc-update-smoke.log`；包含命令历史重载、标准输入动作、图片和子会话续聊/停止/导航/重载。初次双端/重启验证日志 `/tmp/amiba-cordis-rpc-smoke.log` 也通过。本轮使用已构建产品，仅扩展探针与评估记录。
- 仍未把这些证据当成模型发起审批全流程、故意抛错后的界面回退或 Host 冷重启持久化已通过的证明；这些边界分别继续核对。


### 动态业务组件渲染失败隔离（2026-09-13）

- 真实双端测试包在 Host 计数到 3 后，Client 组件于 React 渲染阶段主动抛出 COMPAT_RENDER_FAILURE。官方 renderFailures 报告 tool.view.cordis 和 abdicated:true，截图确认失败业务区域撤下、原工具行和输入器保留。
- 同一原编辑器 DOM 可继续写入并展示新草稿；原工具组仍连接。停止该实例后，官方错误记录和插件 style[data-dyn] 都已清理。
- 官方 Host 会将渲染错误反馈给会话；截图同时显示测试环境缺少模型密钥时的原生凭据错误。这不是插件渲染边界失效，也不把它当作模型恢复生成成功的证据。
- 组合桌面验证完成到最终卸载成功标记，日志 /tmp/amiba-cordis-crash-smoke.log，截图 amiba-cordis-render-failure.png 已查看。覆盖命令重载、图片、输入、子会话续聊/停止/导航/重载及此前兼容项。只增加测试及记录，生产代码无需新增异常边界。

### 工具调用至官方轨迹的定位（2026-09-13）

- 实际 npm rc.2 的 tool.call.toolview.inspect 负责设置 callId 并打开 trajectory；conversation.view 的 owner 携带 inspect / onInspectDone，官方轨迹表选中匹配记录、滚动定位并确认消费。它不是文件打开动作，也不要求启动另一套 ConversationController。
- 原生视图区域增加可选受控选择。Shell 只在 trajectory 已注册且有当前会话时向工具扩展提供 inspect；沿用原工具行及资源打开控件。原 Chat 始终挂载，切回或卸载后保留同一编辑器及草稿。
- 请求由会话访问周期隔离；切换会话、卸载并重装视图后的旧回调失效。旧确认不能清除新请求。消费请求后保持选中 trajectory，用户仍可切回原 Chat。
- 官方组件首次渲染暴露缺少主题变量。新增局限于 data-conversation-view=trajectory 的颜色、字体和边框别名，没有启用全局 ui-theme。最终截图确认时间线、选中工具行、Payload/Result/Timing 正常，原侧栏保持。
- 官方工具行 45 项、定位状态 2 项、视图区域及工具入口 10 项测试通过；Shell/UI 类型检查和完整 Desktop 构建通过。真实官方编译包经 ModuleLoader 与 Cordis 注册后，使用 Host 中真实工具结果验证选中 pkg-2 而非旧 pkg-1。卸载后原编辑器对象、草稿、卡片高度、字体及未泄漏的主题变量均已验证。
- 日志：/tmp/amiba-trajectory-shell-tests.log（原工具行 45 项通过；新增 hook 测试缺少 jsdom 标记已修正）、/tmp/amiba-trajectory-shell-tests2.log（2 项）、/tmp/amiba-trajectory-ui-tests.log（10 项）、/tmp/amiba-trajectory-types2.log、/tmp/amiba-trajectory-ui-types.log、/tmp/amiba-trajectory-build2.log、/tmp/amiba-trajectory-smoke2.log。截图 amiba-trajectory-inspection.png 已查看。
- 桌面测试由测试端加载官方原包，再通过 ctx.plugin 注册。它证明真实组件、数据、定位和清理，不等同于完整插件配置启用、安装依赖图或所有新版轨迹扩展已经验证。默认 bundle 中 ui-trajectory 仍禁用，避免自行增加默认视图。下一步须验证可选插件通过正常 Host 配置进入 Client 图的路径。

### 官方轨迹插件的正常配置启停（2026-09-13）

- 新增隔离 profile 的 Host Loader 测试：通过 loader.create 添加实际官方 ui-trajectory 条目，通过 loader.remove 移除。不修改 bundled 配置，不在测试端注入官方 JS；插件包来自正常 Host 图和浏览器启动加载。
- 初次动态添加后 Host 图已出现 trajectory，但浏览器不消费图变化。复核实际 rc.2 的 dsh-client-hmr，graph 分支明确不处理，仅 rebuilt 分支热更新已有条目。这是官方刷新生效机制，不是轨迹组件的依赖失败。
- 重新加载 renderer 后，真实 trajectory Client fiber 启动，官方会话根 ui-conversation 仍不在 Host 图中。原工具折叠组按现有默认状态恢复；测试展开后点击工具扩展 inspect，官方轨迹选中实际 pkg-2 调用并显示原结果，局部字号为 13px。
- 正常移除条目并重新加载后，轨迹视图消失，唯一 Amiba 根页面及原 Chat 恢复。此路径验证配置和启动依赖，不声称新插件可以免刷新启用，也不将其当作跨刷新未发送草稿持久化的证据；输入状态持久化仍在完整输入适配范围内。上一项免刷新 ctx.plugin 卸载的原编辑器/草稿保留证据仍成立。
- 最终组合回归 /tmp/amiba-trajectory-loader-smoke5.log 退出 0，包含命令历史重载、输入状态、图片、子会话续聊/停止/导航/重载、产出文件、配置及清理。早期日志 1/3 验证了需刷新，日志 2 暴露测试 Host 未声明 clientModules 注入（已修正），日志 4 暴露重载后测试未展开原工具折叠组（已修正）。本轮仅扩展验证脚本和文档，复用已通过构建的生产代码。


### 原生会话草稿与引用持久化（2026-09-13）

- 原输入器改用按会话驻留的草稿源，通过平台 StorageAdapter 保存 version:1 的原生 token 文本。沿用 MentionSerializePlugin 的无损格式，保存 source、ref、label、clipboardText，不将公开显示字符串当作引用身份；首页草稿保持独立。
- 写入按会话串行，订阅释放存储监听；恢复读取带修订号和读取代次隔离，不能覆盖后续编辑或显式空草稿。离屏写入尚未完成时不读取旧磁盘值。异步 setter 绑定原会话，首次发送创建会话后工作目录失败则恢复到实际新会话。
- 官方编辑器绑定延后至序列化更新之后的微任务，避免将上一会话 Lexical 树短暂发布给新会话。早期桌面探针捕获该瞬态；最终验证第二会话收到的每一帧均为空。试验性的同步 Lexical flush 导致原触发管线回归，已完全撤销，保留原异步序列化机制。
- 真实官方触发源插入含中文、Emoji、分隔符的引用，经过会话切换和完整 renderer reload 后逐字段验证身份；第二会话普通草稿也独立恢复，两边显式清空均保留。截图 amiba-resident-reference-draft.png 已查看，原输入器和引用样式保持。
- 草稿源、RichComposerEditor、触发管线及待发送队列共 49 项测试通过（/tmp/amiba-resident-draft-tests5.log）；UI 类型检查通过（types5），完整 Desktop 构建通过（build4）。最终组合桌面回归 /tmp/amiba-resident-draft-smoke3.log 退出 0，涵盖本项、动态 Cordis、正常轨迹配置启停、命令、输入状态、图片和子会话续聊/停止/导航/重载。
- 本项补齐原生文本与引用的生命周期，没有改变附件策略或 UI 样式。官方 useInput、离屏 inputActions、图片驻留及队列恢复仍未全部接通；不据此声明完整输入兼容。


### 完整输入服务的转换边界与引用编码修正（2026-09-13）

- 再次核对实际 rc.2 的 input/contract.d.ts 与 client.js：inputActions.setDraft 接受完整可见文本，机器通过 draft-changed 的 diff scan 保留未编辑的引用。SessionStandardProps.useInput 是非空的 SnapshotSelectorHook；只有 SessionMaybeStandardProps 允许状态为空。因此不能给所有会话提供一个离屏时返回 undefined 的 hook，或把公开文本直接存进原生 token 源来宣称兼容。
- 当前 $setInputDraft 通过可见/原生坐标映射，编辑引用内部时仅解散命中的引用。后续离屏写入必须保留相同语义，并区分普通文本和引用节点；当前 parseTokens 会把识别到的合法 token 解释为引用，单纯将任意公开字符串交给它不是通用的纯文本写入接口。完整驻留输入还需统一 occurrence 身份、draftRev、命令 phase 及图片/队列状态。
- 本轮复现引用 payload 的反斜杠编码缺陷：token 扫描器把原始反斜杠及后一字符当作转义对，最后字段以反斜杠结尾会吞掉闭合方括号，反斜杠后换行同样导致匹配失败。新增 4 个 Windows 路径/换行/百分号及分隔符/Emoji 用例在修复前全部失败（/tmp/amiba-reference-backslash-before.log）。
- 编码器新增 %5C，解码在 %25 之前执行，避免将原有字面 %5C 二次解码。旧合法原始反斜杠路径和已有百分号转义仍有回归覆盖。UI 展示与操作路径未改。
- 相关序列化、驻留草稿、真实 Lexical 编辑操作与触发管线合计 88 项测试通过（/tmp/amiba-reference-backslash-tests.log），UI 类型检查通过（/tmp/amiba-reference-backslash-types.log）。桌面驻留草稿探针改为携带尾反斜杠的真实官方引用，并从同一个 expectedReference 对象生成浏览器注册及重载后的逐字段断言。
- 完整 Desktop 构建通过（/tmp/amiba-reference-backslash-build.log），最终组合桌面回归退出 0（/tmp/amiba-reference-backslash-smoke.log）。真实引用的路径和 clipboardText 末尾均含反斜杠，会话切换及 renderer 重载后逐字段一致；命令、图片、轨迹正常配置启停、动态 Cordis、子会话和插件开发生命周期回归均通过。此结果证明编码及现有链路，不代表完整离屏输入服务已实现。


### 输入公开修订号的跨绑定隔离（2026-09-13）

- 原 InputDraftProjection 生命周期属于一次 Lexical 操作绑定；新绑定会重新从本地 draftRev 和 occurrenceId 起算。公开接口此前直接转发本地值，旧回调可能在返回同一会话后撞上相同修订号，误通过 setInputDraft 的条件写入。
- Bridge 现在为每个会话保留公开修订号与引用编号游标。每次绑定都预留比上一绑定更高的公开修订号；编辑通知和解绑时读取最终本地修订号，即使没有外部订阅者也不丢失中间编辑。状态阶段变化不递增文本修订号，同一绑定中的引用编号保持稳定，新绑定重建的引用不复用旧编号。
- 带 expectedRevision 的公开写入先核对当前公开修订号，再转换回当前编辑器本地修订号，由原编辑器继续执行条件及阶段检查。未提供 expectedRevision 的原写入路径保持；slash/input-* 使用的触发坐标与修订号不改。引用编号目前只保证当前 renderer 内不会因编辑器重建而混用，不宣称跨 renderer 重启保持 occurrenceId。
- 36 项 Bridge、公开动作、输入状态和新绑定测试通过（/tmp/amiba-input-revision-tests2.log），包括无订阅者的最终编辑、旧清理回调、重复访问、引用编号不复用、状态阶段变化、编辑离开后返回相同文本、公开修订号转换及缺少可读状态时拒绝条件写入。Shell 类型检查通过（/tmp/amiba-input-revision-types.log）。
- 桌面驻留草稿探针增加：返回原会话后修订号必须递增，使用离开前修订号的写入必须拒绝，原引用草稿保持。完整 useInput、离屏输入操作及驻留图片状态仍需继续接通。
- 完整 Desktop 构建及最终组合桌面回归均退出 0（/tmp/amiba-input-revision-build.log、/tmp/amiba-input-revision-smoke.log）。真实会话返回后的过期写入被拒绝，既有 input-state 探针的最新修订号写入成功、旧修订号拒绝也通过；引用恢复、命令四阶段、图片、轨迹、动态 Cordis、子会话及插件开发生命周期保持通过。未修改 UI 结构或样式。


### 子会话的真实 Host 冷重启验证（2026-09-13）

- 新增 --child-cold-restart 组合探针，要求同时运行 compat、child-navigation 和 child-continuation。通过现有 agentDiagnostics.restart 更换实际 Host PID，确认旧 PID 已不存在，再完整刷新 renderer；不是只清理前端缓存或模拟断线。
- 重启标记使 Host 测试插件停止创建会话/工具记录，仅重新注册测试模型适配器及原探针。一次性子会话从持久化数据恢复历史、直接父地址和目录，原输入框只读；返回父会话正常。可续聊子会话也能读取原历史；实际官方 subagentAddress 仅返回已发现的地址，先刷新父目录再按 ID 打开可建立地址，不能假定读取历史就等于已发现目录关系。
- 首次完整续聊失败的确切原因来自实际 npm rc.2 dsh-host-apiproxy/lib/index.js 的 subagent.prompt：ctx.agents.get(parentSessionId) 缺失时返回 subagent-parent-unavailable。它要求直接父 Agent 已驻留，不会在此入口自动恢复父会话。错误已通过原输入器展示，不能改成成功或绕过父子归属检查。
- 测试接着通过 ctx.agents.resume({resumeSessionId:原父ID,agentOptions:原测试模型配置}) 恢复同一个已持久化父会话，未新建父/子会话、未注入回复。再次通过原输入框发送后，官方 subagents.coldResume 从原子会话描述恢复运行实例，测试模型生成 COMPAT_CONTINUABLE_REPLY COMPAT_COLD_FOLLOWUP。该结果证明条件满足后可冷恢复续聊；产品的自动父恢复入口、配置恢复及并发恢复管理仍需适配，不将测试端恢复父会话当成生产能力已补齐。
- 初次日志 /tmp/amiba-child-cold-restart-smoke.log 暴露目录地址未发现；第二次 /tmp/amiba-child-cold-restart-smoke2.log 记录父 Agent 不驻留的真实错误。最终 /tmp/amiba-child-cold-restart-smoke3.log 退出 0，包含上述父恢复后的真实续聊及原有完整兼容回归、插件卸载/原配置保留。本轮只增加验证脚本及文档，复用上一轮已验证的生产构建。


### 原发送流程中的直接父会话恢复（2026-09-13）

- prepareSubmit 在既有会话归属/轮换准备完成后，检查目标会话的持久化头与自身日志后缀。普通会话和未持久化的新会话走原路径；仅 version:2、mode:continuable 的子会话尝试恢复日志头指定的直接父会话，跳过 fork seed 中祖先的描述符。
- 已驻留父会话直接复用，包括仍由上层子代理拥有的父会话。冷父会话交给当前 Host 已配置的 typert.lookups.get('agent').resolve，复用官方 ApiProxy 的预设日志恢复、并发复用、缺失身份拒绝及子会话归属限制。不新建解析器、不调用 session.create、不猜测 cwd、模型或父会话 ID。
- 原发送准备接口仍返回原目标 ID；准备失败沿用原输入器的消息/附件恢复路径。父会话本身也是冷子会话时，官方 generic lookup 的 agent-busy 归属限制仍保留，不能把它伪装成普通根 Agent；该层级的 owner 恢复另需适配。
- Host 版 dsh-api-remotes 的直接类型导入会把 Host sessions 声明并入本包 Client 的 Context 类型，导致 SessionStore 与 Client session API 冲突；已移除该导入，改为读取实际服务的窄接口。没有修改官方类型声明或 Client 会话能力来消除报错。
- 9 项准备逻辑测试通过（/tmp/amiba-parent-recovery-tests2.log），覆盖真实身份传递、已驻留父复用、一次性/未知版本/祖先描述符跳过、普通新会话、存储错误、缺失 lookup、自指父身份及归属拒绝。Shell 类型检查通过（/tmp/amiba-parent-recovery-types2.log）。冷重启探针移除测试端 agents.resume，改为要求原生发送流程独立恢复父会话并续聊。
- 完整 Desktop 构建通过（/tmp/amiba-parent-recovery-build.log）；最终组合桌面回归 /tmp/amiba-parent-recovery-smoke.log 退出 0。真实 Host PID 更换并刷新 renderer 后，测试未调用 agents.resume，也未创建父/子会话；原输入框发送触发生产 prepareSubmit 自动恢复普通根父会话，子会话返回真实新回复。一次性子会话恢复、原有命令/图片/输入/轨迹/Cordis/文件/配置/插件生命周期均通过，UI 结构和样式未改。


### 嵌套子会话的驻留条件与草稿保留（2026-09-13）

- 核对实际 rc.2 dsh-subagent 的公共声明：followup 把冷恢复与一条新用户消息的 FIFO 投递合并；startContinuable 是建立新子会话，interrupt 不恢复冷实例，没有独立的无消息恢复入口。内部 continuation.coldResume/materialize 不是公开服务契约。不能为了自动唤醒嵌套父会话而注入额外用户消息，或用 generic Agent lookup 绕过归属。
- 新增 --child-nested-restart：在真实子 Agent 执行期间通过官方 startContinuable 建立真实孙会话，使用独立测试模型回复，再更换第二个真实 Host PID并刷新 renderer。孙会话的历史及目录来自持久化数据；初次发送因其直接父也为冷子会话而拒绝，原输入框中的 COMPAT_NESTED_FOLLOWUP 完整保留，未生成孙会话回复。
- 测试通过原输入框向父会话发送明确的新请求，测试模型模拟一个仍在运行的父任务。此时父会话确实驻留；返回孙会话，直接发送保留的草稿即可得到真实 COMPAT_NESTED_REPLY COMPAT_NESTED_FOLLOWUP。最后通过原停止按钮中止父任务，完成插件卸载检查。没有测试端直接恢复父/孙 Agent。
- 首轮 /tmp/amiba-nested-cold-smoke.log 暴露测试误以为已完成的子会话仍驻留：ctx.agents.get 返回 undefined。实际 continuation 的 settlement watcher 会在 Agent 空闲且无存活子实例时释放它。测试已改为在 Agent stream 执行期间创建孙会话、在父请求仍运行时重试孙会话，不再把历史可读或刚完成请求等同于驻留。
- 最终 /tmp/amiba-nested-cold-smoke2.log 退出 0，包含原有完整兼容回归及两次真实 Host 冷重启。只扩展测试与边界说明，复用已验证的生产构建；不宣称当前已具备无消息自动恢复冷嵌套父会话的能力。


### 发送时保留普通文本与真实引用的节点区别（2026-09-13）

- 原发送链把 Lexical 树先压成 token 字符串，再 parseTokens。因此用户实际输入的 `@[dsh.reference:...]` 示例文本也可能触发不存在的插件引用解析；这会阻断发送或替换原本的普通文本，不符合官方输入中的 occurrence 身份语义。
- 新增 $readComposerParts，从真实节点树读取 text/mention 分段，保留段落分隔和真实引用 payload。payload 是独立副本，调用者修改快照不会修改编辑器。RichComposerHandle 增加可选 getParts，保留原 getValue 和旧调用方式。
- Composer 在提交开始时捕获与本次 draft 一致的分段快照，普通发送仅对其中真实 mention 调用原解析器；旧嵌入器没有该接口或提交的不是当前编辑器值时，仍沿用原 token 解析路径。命令仲裁、提交条件、原字符串协议和所有样式未改。
- 真实 Lexical 节点及完整 Composer 测试区分同样 token 文本的字面内容与真实引用，验证只有真实引用被解析、普通文本按原样提交。44 项编辑器、触发管线及解析测试通过（/tmp/amiba-structured-submit-tests.log），UI 类型检查通过（/tmp/amiba-structured-submit-types.log）。
- 该分段快照目前接到发送路径，尚未替代 version:1 的字符串草稿保存；跨重载保留字面 token 文本与引用的区别，以及离屏编辑共享同一分段状态仍需继续实现，不能据此宣称完整驻留输入完成。
- 完整 Desktop 构建通过（/tmp/amiba-structured-submit-build.log）。首轮桌面日志 /tmp/amiba-structured-submit-smoke.log 中，输入 token 文本打开了原 @ 候选菜单，Enter 被菜单处理，尚未触发发送；探针改用官方 composerInputs.submitInput 进入原普通发送路径，未改变键盘行为。最终 /tmp/amiba-structured-submit-smoke2.log 退出 0，真实模型适配器收到完全一致的 COMPAT_LITERAL_ 文本；同时通过所有既有兼容项、普通和嵌套子会话的真实 Host 冷重启验证。


### 混合草稿的结构化持久化（2026-09-13）

- 原 v1 只保存 token 字符串，无法区分用户输入的普通 token 文字和真正的引用节点。本轮改为 version:2 文档，分别保存 text / mention 片段及完整引用字段；读取 v1 时保留旧解释方式，读取 v2 时不从普通文字推断引用。格式错误或不支持的版本忽略，原串行保存、读取代次和异步编辑隔离继续保留。
- 原 ChatSurface、Composer 和 RichComposerEditor 共享按会话驻留的不可变文档。编辑器直接读取实际节点，字符串 onChange 回写不重复解析；旧字符串 setter 只解释变更区，保留未编辑的普通文字及引用身份。初始化、切换或磁盘恢复使用带标记的原异步 Lexical 更新，避免恢复更新反向覆盖其他会话。
- 相同 canonical 字符串也可能由不同节点组成。文档变化直接取消旧引用序列化，提交前再次检查实际节点；触发修订号也读取结构身份，使旧触发范围失效。新增测试覆盖引用变成同文普通文字、延迟 codec 完成后不发送旧结果，并确认随后能原样发送普通文字。
- 草稿文档/存储、真实 RichComposerEditor、触发管线及节点读取合计 55 项测试通过（/tmp/amiba-document-draft-tests5.log）；UI 类型检查通过（/tmp/amiba-document-draft-types3.log），完整 Desktop 构建通过（/tmp/amiba-document-draft-build2.log）。
- 真实 Desktop 探针使用官方触发源插入含中文、Emoji、分隔符和尾反斜杠的引用，再通过公开编辑接口追加形似引用的普通文字。切换会话和 renderer reload 后确认仅有一个真实 occurrence，原引用逐字段一致、普通文字保留，另一会话不出现上一会话草稿；旧修订号写入仍拒绝，显式清空仍有效。
- 最终组合回归 /tmp/amiba-document-draft-smoke.log 退出 0，包含动态 Cordis、轨迹正常配置启停、命令、图片、输入状态、真实子会话及嵌套子会话 Host 冷重启，以及插件开发生命周期。已查看 amiba-resident-reference-draft.png，原输入框和引用样式保持；四个输入扩展区域卸载后的原编辑器、卡片尺寸及样式检查通过。
- 本轮不等于完整 useInput 实现：未挂载输入器的公开 inputActions、图片驻留、队列编辑/恢复和完整 phase 状态仍需适配。v2 不持久化公开 occurrenceId；发送准备失败后的草稿恢复仍使用原字符串链路，需另行统一结构化恢复语义。


### 原生队列与发送准备失败的结构化草稿恢复（2026-09-13）

- 原队列仅保留已展开的模型文本，编辑时引用身份丢失；编辑后经 Send 发送时，sendNow 又忽略 Composer 传入的已解析文本。本轮在原 PendingChatTurn / RunChatTurnArgs 增加可选原始文档，与 text 模型负载分开保存。旧条目没有文档时沿用旧行为，未替换队列 UI 或存储键。
- 正常发送、排队、自动出队及立即发送携带原始文档。编辑队列项恢复其实际 text / mention 节点；被暂存的输入草稿也保留节点元数据。编辑后的 Send 使用本次解析结果；点击队列的“立即发送”复用原 Composer 的准入、命令及引用解析链路，解析前不会清空、移除队列项或抢先中断当前生成。
- 发送准备失败和只读拒绝优先恢复原始文档；首次发送的工作目录失败按实际会话 ID 恢复文档。旧无文档调用仍保留字符串回退。会话交接继续传递同一 RunChatTurnArgs，不把结构化元数据发送给模型。
- 相关队列、触发管线和草稿存储 50 项测试通过（/tmp/amiba-queue-draft-tests.log），包括 JSON 边界、编辑恢复、编辑后解析文本传递、立即发送未准入时保留状态及出队恢复元数据。UI 类型检查和完整 Desktop 构建通过（/tmp/amiba-queue-draft-types.log、/tmp/amiba-queue-draft-build.log）。
- --queue-draft 桌面探针在真实可续聊子会话生成过程中排队混合草稿，直接读取实际 StorageAdapter 落盘条目，确认模型文本与一个真实引用及普通 token 文字分开保存。通过原队列 Edit / Send now 按钮恢复和编辑；codec 调用从 1 次增至 2 次，真实模型收到准确的新文本，队列项消失，旧生成被中断。
- 实际 Host 冷重启后的嵌套父会话拒绝场景验证：首次 codec 已执行，但发送准备失败后恢复原引用及普通文字；切换至父会话实际运行后返回，原草稿仍在；重试再次执行 codec，模型实际收到完整预期文本。没有投递虚构唤醒消息。
- 最终组合回归 /tmp/amiba-queue-draft-smoke3.log 退出 0，覆盖驻留草稿、动态 Cordis、轨迹正常启停、命令、图片、输入状态、子会话及嵌套 Host 冷重启和插件开发生命周期。首轮探针定位错误地查找输入卡片内的队列（原队列位于 context rail），第二轮用 Markdown 展示文本断言模型原文；修正为原队列位置及实际模型输入证据后通过，未为测试改动产品样式。
- 尚不声明完整官方队列兼容：原生待发送队列与官方 Host inbox 仍是不同状态来源，队列图片生命周期、离屏完整输入和尚未经过 Composer 解析就被编辑动作暂存的草稿发送语义需继续统一。本轮没有完整刷新恢复排队条目的桌面测试；已验证真实落盘及 JSON 恢复后的编辑，不能替代全部恢复生命周期证据。


### 整页刷新后的排队草稿恢复与立即发送（2026-09-13）

- 新增 --queue-reload 探针：真实可续聊子会话仍在生成时，保存含一个真实引用及普通 token 文字的排队消息，然后完整 Page.reload。通过官方目录重新定位原子会话，确认只有一条队列记录、已清空的输入框仍为空；重新注册同名测试引用源后编辑该条目，确认引用和普通文字都正确恢复。
- 首轮真实验证发现运行状态缺口：Host 中旧生成仍在等待，刷新后的原输入器却没有本地 busy 状态。原 sendNow 以 busy 为中断前提，导致新内容进入 Host 队列等待旧任务，而非立即抢先执行。诊断日志明确显示 stopVisible:false、queueRows:1；Host 未收到旧生成的中断。
- 原队列“立即发送”现在对有真实 sessionId 的会话始终发出原 client.abort 操作，由官方接口对已空闲会话处理无操作；本地停止标记、拒绝旧 pendingTurn 和 finally 防重仍只在本地 busy 时执行。只读、未准入及引用解析未完成的路径不触发中断；没有修改普通发送、停止按钮或任何 UI/CSS。
- 新增回归在修复前失败（/tmp/amiba-queue-reload-before.log：1 失败、11 通过），修复后队列及触发管线共 43 项通过（/tmp/amiba-queue-reload-tests.log）。UI 类型检查、完整 Desktop 构建通过（/tmp/amiba-queue-reload-types.log、/tmp/amiba-queue-reload-build.log）。
- 最终组合桌面验证 /tmp/amiba-queue-reload-smoke2.log 退出 0。刷新后编辑原条目、再次解析引用并点击原 Send now，真实 Host 旧生成被中断，模型收到准确的新文本，队列清空。驻留草稿、动态 Cordis、轨迹正常配置启停、命令、图片、输入状态、子会话及嵌套 Host 冷重启和插件开发生命周期一并通过。
- 本项补上上一轮缺少的实际 renderer 重载证据。尚未补齐刷新后执行中会话的全部状态：DshChatEngine 的新实例仅在观察到 turn 事件后建立被动运行态，subscribe 初始缺少状态时发出 absent；普通输入器 busy/Stop 的恢复仍需接入权威状态基线，不能把本次队列修正当成这项工作已完成。


### 官方会话运行状态的原生快照桥接（2026-09-13）

- 已有 conversationSource 返回真实 rc.2 SessionFace，其 ConversationSnapshot.running 由官方运行状态维护。ProductShell 将该现有来源提供给 DshChatEngineClient，不创建第二套 ConversationController，也不重新实现 Host 状态查询。
- 原生快照增加可选 hostRunning。当前 renderer 不拥有本地 turn controller 时读入官方 running；本地提交仍由本地 controller 保护，迟到的 idle 基线不能清空正在提交的任务。来源按会话隔离，重复布尔值不重复发快照；替换、clear 和 dispose 释放订阅，销毁后的回调忽略。
- ChatSurface 的原 busy/Stop 使用该快照字段；只有活动状态、没有本地 turn 内容时仍发 absent，不虚构 begin 或助手占位消息。原 SurfaceActivity 同时恢复 thinking/idle，用户问题与审批继续拥有 waiting 优先级，恢复标记仍保留。
- 原生聊天客户端 23 项、UI 活动/队列/触发管线 50 项，共 73 项测试通过（/tmp/amiba-running-baseline-tests2.log、/tmp/amiba-running-baseline-ui-tests.log）。Runtime、Shell 和 UI 类型检查通过；完整 Desktop 构建通过（/tmp/amiba-running-baseline-build.log）。
- 最终组合桌面回归 /tmp/amiba-running-baseline-smoke.log 退出 0。整页刷新时真实子会话仍在生成，恢复原 Stop 控件、空输入框和唯一队列项；点击原 Stop 后真实 Host 记录中断，队列保留；同一输入框可继续启动任务，排队草稿编辑和重新解析发送通过。动态 Cordis、轨迹配置、命令、图片、输入状态、子会话及嵌套 Host 冷重启、插件开发生命周期同时通过，未修改 JSX 结构或 CSS。
- 仍有需追查的观测：恢复后的 Stop / 新一轮提交已分别满足按钮出现条件，但之后编辑队列前的诊断仍记录 stopVisible:false。当前测试未在该点同步读取官方 running 与本地事件序列，不能据此确定具体竞态原因，也不能据整体退出 0 宣称所有再启动状态已完善。下一步须对照新一轮 Host 真实开始、官方 running 和原生终止事件，排除旧事件覆盖新一轮状态。
- 本桥接面向拥有官方 SessionFace 的 ProductShell；无该来源的独立客户端仍维持既有快照行为。中途刷新后的全部流内容恢复、完整官方 useInput/队列/图片状态继续单独核对。


### 再启动后的按钮模式核对（2026-09-13）

- 对上一轮 stopVisible:false 的观测增加同步证据：重启前记录真实模型开始次数；提交后等待 Host 中出现新的 COMPAT_WAIT_FOR_STOP 执行，再同时等待官方 SessionFace.running=true 和原 Stop 控件。
- 编辑队列项后同时读取官方 running、Stop 控件和原 Queue 控件。实际记录为 running:true、stopVisible:false、queueVisible:true。源码明确规定 busy + 空输入显示 Stop，busy + 可提交输入显示 Queue；因此该观测是保留的原有交互，不是旧终止事件覆盖新运行状态的证据。
- 新增严格断言已通过最终组合桌面回归 /tmp/amiba-running-mode-smoke.log（退出 0），包括真实停止、重启、排队草稿、再次解析、Host 冷重启、插件及既有兼容检查。未修改任何生产代码、UI 或样式，复用 f9a8c9a 的已验证构建。
- 撤销上一轮待查的这条疑似竞态；不将此结果扩展为所有断线/流内容恢复已经验证。后续继续核对完整输入、离屏操作、图片与官方队列生命周期。


### 可见草稿的共用编辑规则（2026-09-13）

- 从真实 Lexical 的 $setInputDraft 提取 atomicTextEdit，沿用 UTF-16 最小差异和完整原子边界扩展。现有编辑器仍用原坐标映射及 $spliceTriggerText；没有替换编辑器、引用样式或交互。段落分隔等结构原子仍由现有扫描器提供。
- 原生结构化文档增加可见文本投影与 updatePublicDraftDocument：有效官方引用投影为完整 @label，其他原生 mention 保留原 token 表达；编辑引用内部只解散被编辑的引用，新增文字始终保持普通文字，未修改的引用字段完整保留。与此前 legacy token setter 分开，保留旧原生调用的含义。
- ComposerDraftSource 新增内部 setDisplayText，使用该文档编辑并沿用修订隔离和串行存储。明确空草稿仍取消待完成恢复；普通 token 文字不会因保存/恢复而变成真实引用。此方法尚未接到官方离屏 inputActions，不声明公开入口已经可用。
- 新增 11 个逐例对照测试：同一结构化草稿分别经真实 Lexical public edit 和驻留文档 public edit，核对实际 text/mention 节点及最终可见文本完全一致；涵盖原样、前后追加、中文/Emoji 引用内部修改、跨引用替换、换行、删除、新增 token 文字及清空。另验证公开文档编辑的保存/恢复和引用解散。相关测试共 93 项通过（/tmp/amiba-public-document-tests.log），UI 类型检查通过（/tmp/amiba-public-document-types.log）。
- 完整 Desktop 构建通过（/tmp/amiba-public-document-build.log），最终组合回归 /tmp/amiba-public-document-smoke.log 退出 0，含现有公开输入、驻留引用、队列与整页刷新、运行状态、命令/图片、动态插件、轨迹及子会话冷重启。未修改样式或 JSX 结构。
- 后续仍需将驻留文档接到标准会话提供者，并统一离屏快照、公开修订号/occurrence 身份、phase、图片和官方队列；本项仅完成其可复用的文字/引用转换，不代表完整 useInput 兼容。


### 标准 inputActions 的离屏草稿写入（2026-09-13）

- Shell 通过 UI 根模块导出的 sessionComposerDraft 使用原输入器同一驻留文档。真实会话提供者持有和释放订阅；标准 inputActions.setDraft 在原编辑器离屏时按会话 ID 写入该文档，沿用前一轮可见文本编辑规则与串行保存。未绑定会话拒绝写入，旧提供者释放不会解除新提供者的所有权。
- 已挂载输入器始终走原编辑器操作，阶段或只读拒绝不能绕过；离屏的一次性子会话按真实 SessionFace 的 one-shot 地址拒绝。没有替换编辑器、JSX 或 CSS。
- 输入状态来源、触发桥与动作提供者共 37 项测试通过（/tmp/amiba-offscreen-input-tests3.log）；Shell 和 UI 类型检查通过（/tmp/amiba-offscreen-input-types2.log、/tmp/amiba-offscreen-input-ui-types.log）。完整 Desktop 构建通过（/tmp/amiba-offscreen-input-build.log）。
- 最终组合桌面回归 /tmp/amiba-offscreen-input-smoke.log 退出 0。探针保存官方 sessions.provide 的真实 inputActions，切换到另一会话后调用原会话 setDraft；当前输入框保持为空，切回及整页刷新后，原真实引用及新增普通文字完整保留。实际一次性子会话离屏后的标准写入也明确拒绝。原队列、刷新恢复、运行状态、命令与图片、动态 Cordis、轨迹、子会话及嵌套 Host 冷重启、插件生命周期一并通过。
- 范围限定：此次验证已有绑定、先前打开过的会话的离屏写入，不声明首次异步恢复前的同步写入已覆盖全部恢复情况。完整 useInput、离屏公开快照、严格修订号与 occurrence 身份、离屏图片和提交、完整官方队列仍待适配；不会生成虚假的离屏修订号或绕过原提交准入。

### 编辑时暂存的草稿在真实自动出队前解析（2026-09-13）

- 发现两个实际缺口：Edit 将输入框原草稿放入队尾时尚未执行引用 codec；ChatSurface 的 runChatTurn.finally 仍保留独立旧出队逻辑，绕过 usePendingQueue.drainHead 且未传递原始 draft。此前队列模块测试不能证明真实自动出队已接通，本轮补上该调用链。
- 新暂存的结构化草稿使用可持久化 needsResolution 标记。直接 Send now 和自动出队先调用原 Composer 的 expandMentionPartsAsync、providerRegistry 和真实 trigger resolver；普通文字不重新解析为引用。此前已提交并解析的队列项继续使用原模型文本，不重复执行 codec。
- 异步解析完成前不移除条目、不抢先中断旧生成、不更改当前输入框。失败或解析为空且没有附件时保留条目、暂停队列并使用原错误区域提示。停止、删除、编辑、切换会话、只读变化和卸载取消待完成解析；迟到结果检查原条目身份及会话所有权。
- 真实 finally 现调用当前会话的队列 drain，携带原始文档，避免旧会话结束触发新会话出队。同步消费 queue ref 避免渲染前连续 drain 重复发送同一条。新增回归先失败（/tmp/amiba-stashed-queue-drain-before.log：1 失败、19 通过），最终队列及 Composer 触发管线共 52 项通过（/tmp/amiba-stashed-queue-tests5.log）。UI 类型检查通过（/tmp/amiba-stashed-queue-types4.log）。
- 最终完整 Desktop 构建通过（/tmp/amiba-stashed-queue-build3.log）。新增 --queue-stash 使用真实引用源和普通 token 文字，点击原 Edit 暂存未提交草稿，再发送编辑项并等待原自动出队。实际模型日志逐字匹配 codec 输出和普通文字，调用次数准确。首轮探针同时添加前后缀，按原最小差异规则解散了引用；改为两次独立编辑后通过，未改变产品编辑规则。
- 最终组合回归 /tmp/amiba-stashed-queue-smoke2.log 退出 0，覆盖离屏草稿、排队及刷新恢复、运行状态、命令/图片、动态 Cordis、轨迹、子会话及嵌套 Host 冷重启、插件安装/HMR/卸载。原编辑器与卡片尺寸、样式检查继续通过，无 JSX 或 CSS 变更。
- JSON 测试覆盖新暂存标记持久化，桌面验证覆盖真实暂存后的自动出队；不将旧版本无标记记录猜测为待解析草稿。队列图片所有权及清理、完整 Host inbox 对齐、完整离屏输入和官方 useInput 仍需适配，不代表全部队列兼容。

### 队列和输入框共享附件的文件清理（2026-09-13）

- 实际问题：Edit 复制 Attachment 对象但共享 attachmentId。原 cancelEdit、图片移除、会话切换直接调用文件删除，会破坏仍留在队列中的原文件；删除编辑项又可能对同一文件重复删除。
- 增加 deleteUnretainedAttachments，按 Host staging ID 核对保留的队列与输入框附件，并对一次清理去重。取消编辑保留队列原附件、释放新添附件；删除行保留其他行及未清空输入框的文件；提交编辑后的附件列表释放弃用的旧文件，保留本次发送使用的文件。
- 原 useComposerAttachments 增加可选队列所有权查询，图片移除及清空仍更新原 UI 和浏览器注册，仅在队列没有持有同一文件时删除 Host 文件。无队列的调用方保持原行为。ChatSurface 的切换会话、新建会话及错误清理分别保留仍被队列或输入框持有的附件。没有改动 JSX 或 CSS。
- 队列、附件所有权和真实 Composer 触发管线共 59 项测试通过（/tmp/amiba-queue-files-tests2.log）；UI 类型检查通过（/tmp/amiba-queue-files-types2.log）。完整 Desktop 构建通过（/tmp/amiba-queue-files-build.log）。
- 新增 --queue-files：真实上传 PNG、排队、读取实际存储记录中的 attachmentId，定位对应 Host 原始文件；经取消编辑、移除图片及切换会话后逐字节比较，删除最后一条队列记录后确认 ENOENT。首轮只上传图片而等待带文字的排队按钮超时，按现有交互补入文字后通过，没有为探针更改按钮规则。
- 最终组合桌面回归 /tmp/amiba-queue-files-smoke2.log 退出 0，同时覆盖离屏草稿、引用队列与自动出队、刷新恢复、运行状态、命令及官方图片操作、动态 Cordis、轨迹、子会话及嵌套 Host 冷重启、插件安装/HMR/卸载。原编辑器、卡片尺寸及样式检查继续通过。
- 本项验证队列与输入框的文件所有权，不代表完整官方图片生命周期：浏览器 File/草稿图片 ID 在队列恢复时的重建、发送中所有权和完整 Host inbox 对齐仍需核对。测试仅暂存并删除子会话队列图片，没有发送图片至子会话，不改变 rc.2 子会话图片输入限制。

### 队列图片恢复后的浏览器注册（2026-09-13）

- 队列序列化保存 Attachment 和 Host staging ID，原上传时的浏览器 File 注册在清空输入框后释放。此前编辑恢复只显示原生缩略图，官方 inputImagesFor 仍为空。本轮在原 useComposerAttachments 中为缺少注册的就绪图片读取同一 Host 文件，重建 File 并调用原 registerDraftImage。
- 新草稿 ID 来自真实官方注册，不复用 Host staging ID；不重新上传文件。原生上传已有注册时不重复读取或注册。发布继续使用原同步图片快照和订阅，取消编辑、移除及卸载沿用原 release。
- 恢复按 native uiId、Host ID、注册提供者及当前附件集合检查所有权，迟到读取不重新添加已移除的图片。同一 native 行指向新 Host 文件时先释放旧注册，避免展示旧文件。身份不匹配或注册不可用时保留原生附件，不发布虚假图片；失败记录不在每次渲染时无限重试。
- 会话切换现在同时清空原 editingQueueId，避免把已离开的队列编辑状态带到另一个会话。该修正不改变输入框结构、原按钮样式或附件上传流程。
- 图片恢复、附件所有权、队列及 Composer 触发管线共 65 项测试通过（/tmp/amiba-queue-image-restore-tests3.log），覆盖准确字节、新 ID、无二次上传、快照稳定、清理、迟到读取、提供者/Host ID 更换及无效身份。UI 类型检查通过（/tmp/amiba-queue-image-restore-types4.log）；完整 Desktop 构建通过（/tmp/amiba-queue-image-restore-build.log）。
- --queue-files 增强验证真实 inputImagesFor 返回的 File、名称、MIME、完整字节、官方 registry 查找和 ID 与 Host ID 不同。新增 --queue-image-reload 完整刷新 renderer，从真实持久化队列重新编辑图片并执行同样检查，最后删除原行并确认浏览器注册和原文件均释放。另确认离开编辑中的会话后新会话不残留 Cancel edit。
- 最终组合桌面回归 /tmp/amiba-queue-image-restore-smoke.log 退出 0，含原有动态插件、输入/图片/命令、离屏引用、队列解析及刷新、运行状态、轨迹、子会话及嵌套 Host 冷重启和插件开发生命周期。原编辑器、卡片尺寸及样式检查通过。
- 本项重建 File 和新的浏览器 ID，不宣称持久化原 File 对象身份、原 lastModified 或跨 renderer 的浏览器 ID。发送中所有权、离屏图片操作和完整官方输入/Host inbox 状态仍需继续适配。子会话图片测试仍限于队列暂存、编辑和删除，不宣称 rc.2 支持子会话图片发送。

### 当前窗口发送期间的附件保留（2026-09-13）

- 原队列和输入框保留检查无法覆盖已离开草稿、仍等待发送准备的附件。原 runChatTurn 在会话交接、Agent/工作目录准备及实际发送前存在异步等待，此时删除共享队列副本可能提前删除正在使用的文件。
- 增加 withSendingAttachments，按 Host ID 对当前 renderer 中重叠的发送分别计数。原 runChatTurn 在进入既有发送函数前取得临时保留，覆盖早退、准备错误、交接和完整执行，在 finally 释放。没有改变原发送正文、附件身份或提交接口。
- deleteUnretainedAttachments 同时检查发送保留；原图片移除与清空也使用这项检查。发送结束只解除临时保留，不自动删除可能已进入历史或已恢复到草稿的文件；仍由原清理动作决定删除。
- 原生图片注册、图片恢复、附件所有权、队列和 Composer 触发管线共 79 项测试通过（/tmp/amiba-sending-files-tests2.log），包括受控等待期间删除队列副本和原图片、重叠发送、同一发送内重复 ID、准备拒绝后的释放及无自动删除。UI 类型检查通过（/tmp/amiba-sending-files-types2.log）。
- 完整 Desktop 构建通过（/tmp/amiba-sending-files-build.log）；组合桌面回归 /tmp/amiba-sending-files-smoke.log 退出 0，覆盖原有图片注册/恢复/清理、队列发送、刷新、离屏草稿、命令、动态插件、轨迹及子会话冷重启。未修改 JSX 或 CSS，原卡片尺寸及样式检查通过。受控暂停发送期间的竞争条件由上述 hook 测试验证，未把现有桌面组合探针宣称为该竞争条件的专用端到端验证。
- 本保留表仅属于当前 renderer，不是 Host 的持久化引用表。跨窗口同时操作、已发送历史中的长期文件引用、跨重启所有权仍需由 Host 层继续核对；完整官方图片及输入生命周期尚未全部完成。

### Host 持久化附件会话引用（2026-09-13）

- 确认原 Host removeAttachment 直接删除对象及元数据，无法识别另一窗口或会话已经引用该文件。本轮在原元数据增加可选 retainedBy，会话引用使用原文件 ID，不复制文件或改动消息展示。
- 新 retainForSession 原子替换元数据，对重复会话幂等；同一 Store 的同一文件按顺序处理引用登记与删除，登记成功后普通 remove 返回 deleted:false。元数据校验检查引用字段，未登记文件保持原删除流程。重新创建 Store 后仍读取持久化引用。
- 增加同名 Typert Remote 描述与 Host 方法，原桌面及通用 DSH 平台适配器调用该接口。AgentAttachmentsAdapter 使用可选方法维持其他宿主兼容；实际 Amiba 适配器提供它。原 DshChatEngine 在只读地址检查后、会话解析/创建和附件读取之前等待引用登记，涵盖图片及文本/PDF附件 ID，重复 ID 只登记一次。
- 存储 5 项测试通过（/tmp/amiba-host-file-refs-tests2.log），含多会话幂等引用、重建 Store 后保留原字节、登记与删除并发排序和普通草稿删除。运行时 32 项通过（/tmp/amiba-host-file-refs-runtime-tests3.log），其中真实引擎测试延迟登记回包，确认完成前既不读取图片也不调用 prompt。Runtime、附件插件及 Desktop 主进程类型检查通过（/tmp/amiba-host-file-refs-types.log、/tmp/amiba-host-file-refs-plugin-types.log、/tmp/amiba-host-file-refs-desktop-types.log）。
- 完整 Desktop 构建通过（/tmp/amiba-host-file-refs-build.log）。新增 --host-file-refs 使用原 Electron DSH HTTP 通道调用真实 put、retainForSession、removeAttachment、readForPrompt，确认删除返回 false 且完整字节仍可读取。首轮误把该原生 HTTP 服务声明为 Client Cordis 服务 remote.amibaAttachments，导致探针等待不存在的服务；修正为实际原生通道后通过，未添加虚构客户端服务。
- 最终组合回归 /tmp/amiba-host-file-refs-smoke2.log 退出 0，同时通过未登记队列图片最终清理、浏览器注册恢复、整页刷新、输入与命令、动态插件、轨迹、子会话及嵌套 Host 冷重启等原回归。Store 重建后的引用持久性由存储测试验证，不把组合中的 Host 冷重启等同于已专门复查该新增引用。
- 范围：新登记引用在模型执行前写入，提交失败也保留文件，以免损坏已记录或可重试内容。当前没有旧历史迁移或 release-session 回收流程，尚不能声明长期存储生命周期完整。引擎收到提交前的 UI 准备阶段仍只有当前窗口临时保留；多 Host 进程同时写同一目录不在本轮验证范围。没有 JSX/CSS 改动。

### 打开旧历史时补登记附件引用（2026-09-13）

- loadMessages 已分页读取完整日志并通过既有 projectRuntimeSessionHistory 生成 attachmentBadges。本轮复用该结构化结果，仅对符合真实 Host att_32位十六进制格式的 ID 去重登记引用；不按文件名、缩略图、裸文本 ID 或内联图片 hash 推测归属。
- 登记完成后返回原历史消息，消息正文、显示顺序和附件标记不变。历史文件可能已缺失，逐项登记失败只记录诊断，不阻止查看历史；无该可选平台接口的宿主保留原行为。
- Host 提取公共元数据校验，retain 和 remove 检查 ID、对象类型/大小及引用字段时不读取完整文件字节。实际 read 仍读取字节并核对长度；原有符号链接与路径限制保持。避免重复打开旧历史时为幂等登记加载大图片。
- 历史存储与投影共 24 项测试通过（/tmp/amiba-legacy-file-refs-tests.log），覆盖跨页去重、非 Host ID 排除、普通文字排除、缺失文件和原历史保留；Host 存储 5 项通过（/tmp/amiba-legacy-file-refs-store-tests.log）。Runtime 和附件插件类型检查通过（/tmp/amiba-legacy-file-refs-types.log、/tmp/amiba-legacy-file-refs-plugin-types.log）。
- 完整 Desktop 构建通过（/tmp/amiba-legacy-file-refs-build.log）。新增 --legacy-file-refs 使用真实 Host 创建未登记文件，检查原元数据没有 retainedBy；测试 Host 插件直接写入旧格式的规范历史事件，不经过新发送逻辑。刷新 renderer 后打开该历史，检查元数据新增原会话 ID，再请求删除并逐字节读取验证文件保留。
- 最终组合回归 /tmp/amiba-legacy-file-refs-smoke.log 退出 0，包含该迁移、原 Host 引用、队列/图片恢复及清理、输入/命令、动态插件、轨迹、子会话及嵌套 Host 冷重启。无 JSX/CSS 改动，原界面检查继续通过。
- 回收边界核对：当前 Amiba 的移出列表操作是 workspace.archiveSession；sessions-store 明确保留日志且归档视图仍可打开。因此不把归档接为 release-session，也不在兼容任务中新增永久删除能力。按需迁移不等于全库扫描，未打开旧会话的引用尚未预登记；其他窗口在引擎收到提交前的准备阶段仍需继续核对。


### 标准 useInput 与驻留输入快照（2026-09-13）

- 根据实际 rc.2 的 sessions.provide 契约注册 `hooks: ["input"]`，由官方渲染器生成 selector Hook；保留原输入器和 inputActions。
- 原生 ComposerDraftSource 增加只读输入投影：实际文字/引用使用完整 @label 的 UTF-16 坐标，普通 token 形状文字不被重新解释。持久化恢复和外部修改通过原订阅通知；连续修改即使没有中间读取，也会推进修订。未改动引用在驻留文本编辑中保留独立 ID。
- 挂载时继续使用真实 Lexical 状态、命令阶段、浏览器图片和 SessionFace 的 Host inbox；离屏时使用原生驻留草稿，遵循已有的退出命令和清空浏览器图片策略。离屏修订写入拒绝过期版本和一次性只读子会话。
- 保留 `inputDraftFor` 的原有“已挂载编辑器”含义。第一次桌面回归发现把该接口改成离屏可读会使既有就绪检查提前通过，已恢复旧语义；新增驻留读取经 `inputDraftSource`、`inputStateSource` 和标准 useInput 提供。编辑器重绑定会推进修订并重分配公共 occurrence ID，避免旧写入命中新绑定。
- 验证：40 项桥接测试、64 项原生草稿/真实 Lexical 编辑测试通过，补充验证异步恢复后的输入投影及迟到读取隔离；插件类型检查和完整桌面构建通过。桌面插件视图直接调用 useInput，四个输入区域同时比较标准 Hook 与真实 owner 状态；离屏写入、订阅、过期拒绝、切换/刷新以及原卡片样式尺寸均通过。
- 范围仍未全部完成：离屏图片修改和提交、跨挂载公共引用 ID 连续性、引用外观/失效/粘贴语义、原生队列与 Host inbox 的完整行为对齐仍需继续处理。

验证记录：`/tmp/amiba-resident-input-tests.log`、`/tmp/amiba-resident-input-ui-tests.log`、`/tmp/amiba-resident-input-hydration-tests.log`、`/tmp/amiba-resident-input-ui-types.log`、`/tmp/amiba-resident-input-build2.log`、`/tmp/amiba-resident-input-smoke3.log`。完整组合桌面回归退出码为 0，包含队列/图片刷新、Host 附件引用、旧历史附件迁移、Cordis、轨迹加载、命令展示、running 恢复及两级子会话冷重启。


### 离屏官方图片操作与原生交接（2026-09-13）

- 已绑定的离屏会话可通过标准 inputActions.addImages/removeImage/pruneImages 操作真实浏览器图片。整批 ID 校验成功后才取得注册表引用；保留原始 File、图片 ID 和预览地址，不把 Host 文件 ID 冒充浏览器 ID。
- 仅显式离屏新增图片驻留；原生上传附件仍遵循已有的会话切换/卸载清理。回到目标会话后，在父级切换清理完成的 microtask 中，且原编辑器允许接收时，交给原 addDraftImages 上传路径。上传结束、只读等可用性变化有独立通知，不依赖图片列表发生变化才能重试交接。
- 挂载编辑器拒绝接收时不另建驻留副本。过期绑定不能接管图片；未交接图片在实际 Session owner 解绑时释放。共享图片按现有租约计数，交接不重新创建 File，不释放已交给原生上传器的租约。
- 41 项桥接测试、39 项真实 Composer/命令图片测试、插件及 UI 类型检查、完整桌面构建通过。新增 --offscreen-images 桌面验证标准接口的添加/移除/裁剪、其他会话隔离、原附件条接管、原命令路径的确切 PNG 字节和最终注册释放；完整组合回归退出码为 0，原输入卡片样式尺寸及队列、附件引用、Cordis、轨迹、子会话冷恢复均通过。
- 日志：/tmp/amiba-offscreen-images-tests.log、/tmp/amiba-offscreen-images-ui-tests.log、/tmp/amiba-offscreen-images-types.log、/tmp/amiba-offscreen-images-ui-types.log、/tmp/amiba-offscreen-images-build.log、/tmp/amiba-offscreen-images-smoke.log。
- 边界：驻留的是本次浏览器运行中的图片注册，不跨浏览器重启持久化；离屏直接提交仍未接入。完整输入、引用和新版插槽/服务兼容目标继续保留。


### 离屏提交的引擎接收确认（2026-09-13）

原 ChatEngineClient.submit 返回 void，begin 又发生在准备和 Host 请求之前，不能作为离屏清空草稿的依据。本轮给真实 DshChatEngineClient 增加可选 submitWithReceipt，保留旧 submit 事件入口，共用实际准备、模型选择、附件引用/读取、事件订阅和 prompt 路径。

- accepted 来自实际 session.prompt 的 accepted 标志，或 subagent.prompt 的非空 messageId；Host 命令的 success/error 结果独立保留，不等同于模型任务完成。
- 准备前失败和明确 RPC 拒绝返回 rejected；请求发出后网络错误、取消或无效确认返回 unconfirmed，不能据此认定没有投递。回执只结算一次；后续流结束或中断不改写已经确认的接收结果。
- 新接口的重复提交拒绝只返回给该调用方，不发送会结束原回合的错误事件。引擎销毁会结算待确认请求，销毁后不再启动新提交。准备期间取消后，即使不响应 AbortSignal 的适配器随后返回，也不会继续发出 prompt。
- 36 项引擎测试通过，包括原发送路径、确认前等待、命令结果、两路子会话独立确认、重复提交、明确 RPC/不确定网络结果、异步准备取消、同步 begin 回调取消，以及确认失败不等待延迟的连接清理。运行时类型检查通过。
- 尚未将标准 inputActions.submit 接到离屏发送。原 ChatSurface.runChatTurn 同时依赖当前会话的工作目录、消息、检查点和交接闭包；后续必须使这些步骤按目标会话执行，并衔接驻留草稿/图片/命令事务。不能用直接调用 session.prompt、切换用户当前页面或创建另一套隐藏 ChatSurface 代替。

验证记录：/tmp/amiba-submission-receipt-tests.log、/tmp/amiba-submission-receipt-types.log、/tmp/amiba-submission-receipt-build.log、/tmp/amiba-submission-receipt-smoke.log。完整桌面构建及包含离屏图片、队列恢复、附件引用、Cordis、轨迹和子会话冷恢复的组合回归均通过，退出码 0；桌面回归验证原 submit 路径，新增接收确认的分支语义由引擎测试覆盖，尚未声称离屏标准提交已完成。


### 目标会话的检查点与原生文件搜索（2026-09-13）

- WorkspacePane 增加 beginTurnFor(sessionId, turnIndex)，直接调用该目标的原开发能力，并更新其检查点集合和活动检查点。旧 beginTurn(turnIndex) 委托到当前会话，原 UI 调用及默认行为保留；后台工具事件仍由现有 observeToolEvent 按事件会话标记修改。
- 每个目标的检查点创建请求独立跟踪；较旧请求晚到的成功、失败或非 Git 空结果，不能覆盖或删除较新请求的活动检查点。实际创建的历史检查点仍保留，不删除文件或恢复点。
- 原生 workspace-files provider 允许直接传入固定 sessionId，ProductShell 按会话构建实例；保留的提供者不会因当前页面选择改变而改查另一个会话。旧 getSessionId 回调形式仍支持。这里改的是搜索地址绑定，原有文件引用序列化仍返回相同路径。
- 19 项 React 工作区/文件提供者/目录选择测试、UI 与插件类型检查通过。测试覆盖后台创建期间切换前台、后台修改标记、迟到请求和现有面板行为。既有文件树测试缺少目录选择上下文，在 HEAD 的原 WorkspacePane 上也复现同样失败（/tmp/amiba-addressed-preparation-baseline-test.log）；仅为该夹具补齐实际上下文，未改产品按钮逻辑。
- 完整桌面构建和组合回归通过，退出码 0；原卡片样式、附件/队列、离屏图片、Cordis、轨迹及子会话冷恢复继续通过。后台检查点接口由 React/适配器测试覆盖；此次未声称标准 inputActions.submit 已能离屏发送。
- 记录：/tmp/amiba-addressed-preparation-tests.log、/tmp/amiba-addressed-preparation-ui-types.log、/tmp/amiba-addressed-preparation-plugin-types.log、/tmp/amiba-addressed-preparation-build.log、/tmp/amiba-addressed-preparation-smoke.log。

后续仍须接通按目标会话准备消息/模型/工作目录的原引擎发送，并处理驻留草稿、命令、图片和接收结果的事务。已确认原生文件 serialize 只返回路径，搜索的会话地址现已固定；不得把当前会话的 pendingModelSelection、activeMessages 或工作区 UI 状态用于其他目标。Host 附件 ID 由 randomUUID 生成，不能假定重复上传会按内容去重；离屏图片发送还需要保存和交接已暂存附件，避免失败重试重复上传和遗留文件。
# 离屏附件准备与原输入器交接：桌面验证通过

## 后续：目标会话后台发送器

内部 `sendResidentTurn` 已绑定原 ChatSurface 的引擎，不新建隐藏输入器或切换页面。发送前调用官方会话准备并处理重定向；从真实 Host 读取目标元数据和历史，按目标地址解析目录、创建检查点、准备 Markdown，再调用 `submitWithReceipt`。准备锁覆盖源和重定向目标，准备期间转到前台、已有本地发送或 Host 实际运行会拒绝；子会话的一次性只读及图片限制继续保留。派发后的未知异常返回 unconfirmed，已接收后的本地索引失败不改变接收事实。SessionsController 暴露原 store.getSnapshot，异步检查读取实时状态，不依赖旧 React 闭包。

验证：后台发送器 5 项测试、桥接/驻留附件 8 项测试，UI、运行时及插件类型检查通过；完整构建和桌面兼容回归通过。新增 `--resident-sender` 对真实可续聊子会话执行后台文本发送，检查 accepted 回执、目标模型日志、前台原编辑器及草稿不变、返回后真实回复。首次测试未把新文本加入假模型的识别列表，误选了之前的等待停止输入；补齐夹具标记后完整重跑通过。证据为 `/tmp/amiba-resident-sender-tests.log`、`/tmp/amiba-resident-sender-bridge-tests.log`、`/tmp/amiba-resident-sender-{ui,plugin,runtime}-types.log`、`/tmp/amiba-resident-sender-build.log`、`/tmp/amiba-resident-sender-smoke2.log`。

边界：该内部接口接收已完成判定和引用展开的文本，不消费草稿。标准 `inputActions.submit` 的离屏命令判定、状态、草稿消费/失败保留、完整队列对齐仍待接通。后台图片发送尚无真实模型端实测，不能由子会话文本用例推断全部支持。

## 附件准备与交接记录

驻留图片增加按原始注册实例缓存的上传准备与引用持有。并发准备和失败重试复用同一 Host 文件；取消调用不会丢弃仍属于草稿的已上传文件。删除草稿图片后，待进行中的上传和发送持有释放再清理文件。发送持有期间暂缓交给原输入器，交接后文件清理由原输入器和队列负责。

原输入器增加已准备图片的接收路径：保留浏览器 File 和草稿 ID，采用原 Host 附件 ID，仅创建新的原生附件行 ID，不再次上传或解析会话。原上传路径和界面布局不变。

当前验证：驻留图片与上传准备 7 项测试、原输入器及触发管线 32 项测试通过；UI 和插件类型检查通过。完整桌面构建和兼容回归通过。新增真实检查确认两次准备生成同一个 Host 文件，持有期间切回会话不提前交接，释放后原输入器接收真实 File/ID 且不增加文件，原生命令收到准确图片字节。日志为 `/tmp/amiba-prepared-staging-tests.log`、`/tmp/amiba-prepared-native-tests.log`、`/tmp/amiba-prepared-ui-types.log`、`/tmp/amiba-prepared-plugin-types.log`、`/tmp/amiba-prepared-build.log`、`/tmp/amiba-prepared-smoke.log`。标准离屏提交尚未接通，不能据此标记完整输入兼容。
