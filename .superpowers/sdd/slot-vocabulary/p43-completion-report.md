# Phase 4.3 (completion) — inputTriggers + commandUi adoption

Branch `worktree-agent-a7785dbee6aafe85d`, base `main @ d5a2cdb`. Six commits,
none pushed, none merged.

| commit | scope |
| --- | --- |
| `144c864` | Step 3 — Amiba's sources become official `InputTriggerSource`s (inert until the flip) |
| `5e5729f` | Steps 2 + 4 — bundle rows enabled, host bridge, shadow seats |
| `829ba7f` | tests |
| `1c82f73` | docs + verify assertions + smoke pins |
| `193da86` | fix: re-resolve the controller when the DSH session materializes |
| `bab2fdd` | fix: defer the source registration until `inputTriggers` exists |

Status: **all four steps landed.** Nothing was faked; one contract member is
deliberately not driven and is documented as such (see Concerns).

---

## The PickOutcome → Lexical mapping, and where it was derived

Derived from the two built bundles under
`packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/`,
not from any table quoted to me. `ui-conversation` is the SessionInputShell /
InputMachine side, `ui-input-trigger` is the controller side.

| outcome | event dispatched | draft transform | derived from |
| --- | --- | --- | --- |
| `{ claim }` | `slash/input-begin-command` | `draft = claim.token + draft.slice(span.end)`, phase → `claimed`; requires phase ∈ {plain, claimed}, span CAS, and `draft.slice(0, span.start).trim() === ""` | `dsh-client-ui-conversation/lib/client.js:546-561` (`onBeginCommand`), `:1100-1108` (`beginCommand`) |
| `{ insert }` | `slash/input-insert-reference` | `[span)` → one U+FFFC + a separating space unless one already follows; mints an occurrence at `span.start` | same file `:562-589` (`onInsertRef` / `replaceSpanWithChip`), `:1115-1123` |
| `{ text }` | `slash/input-insert-text` | CAS then `draft.slice(0,start) + text + draft.slice(end)` | same file `:1154-1160` |
| — (post-success) | `slash/input-consume-token` | span guard: CAS + `start !== end` then splice out; bare-token guard: `draft.trim() === token` (token non-empty) then clear | same file `:595-623`, `:1131-1142` |
| `'handled'` / `undefined` | nothing dispatched | none | `dsh-client-ui-input-trigger/lib/client.js:484-499` (`execute` returns false before dispatching) |

Two derivations that were not obvious and are worth recording:

- **`execute` routes `{text}` BEFORE `{insert}`** (`"text" in outcome` is
  checked second, `"claim" in outcome` first, `insert` is the fall-through).
  `applyPickOutcome` mirrors that order exactly.
- **`adjudicate` does NOT apply insert/text outcomes.** `onAdjudicated`
  (`:784-804`) acts only on the `{claim}` arm and on `undefined`; `'handled'`,
  `{insert}` and `{text}` returned from `matchEnter` fall through to nothing.
  `Composer.handleSend` mirrors that, rather than "helpfully" applying them.

Amiba's implementation lives in
`packages/ui/src/chat/composer/triggers/editor-ops.ts`.

### The draft projection

The draft handed to `track()` is NOT the persisted `value` string. A chip
contributes exactly **one U+FFFC** — the official placeholder convention
(`ReferenceInsert` doc: "the draft holds one U+FFFC placeholder per
occurrence"). This is load-bearing: `MentionNode.getTextContent()` is the
canonical `@[type:body]` token (that string IS Amiba's persisted value), and
feeding that to the official detector would make every chip re-trigger the
menu, because the detector scans left for `@` and finds the one that opens the
token. With a single placeholder, a trigger typed right after a chip opens
normally and a chip before the trigger correctly yields `position: "inline"`
(U+FFFC is neither whitespace nor a word char). Implementation:
`triggers/lexical-draft.ts`.

This also closes most of the P4.4 `occurrences` gap incidentally: the
occurrence table is the node tree.

### Codec round-trip

A pick's `{insert}` becomes a `dsh.reference` mention whose payload is
`{ source, ref, label, clipboardText }`. At submit, `expandMentionsAsync`
routes it through `controller.serializeReference(source, ref, signal)` —
i.e. the owning source's `ReferenceCodec`. Legacy `@[skill:…]` / `@[session:…]`
tokens are mapped onto the SAME codecs by `legacyReferenceOf` rather than
keeping a second serializer alive beside them, so old drafts still rehydrate
and still produce byte-identical model text (`/name`, and the
`@[title](dsh-session:…)` link). A serialization failure **blocks the send**
with a visible reason; there is no downgrade to clipboard text.

---

## How each bail listener determines "actually applied"

Registered in `plugins/dsh-plugin-ui-shell/src/client/input-trigger-bridge.ts`
(`bindEditor`), each as `ops.<verb>(…) ? true : undefined`. The verbs live in
`triggers/editor-ops.ts` and all run inside
`editor.update(…, { discrete: true })` with a `ran` flag, so:

- **a nested `editor.update` answers false.** Lexical DEFERS a nested update
  closure, so `ran` stays unset. This is why `onSpace` rides a *native* root
  keydown listener rather than a Lexical command — a command handler runs
  inside `editor.update`. Upstream reaches the same conclusion from the other
  side (it listens on the textarea).
- **`insertText`** — re-scans the draft after the splice; `true` iff the draft
  string actually changed. A CAS miss returns before touching the tree; a
  byte-identical splice answers **false**. This is STRICTER than upstream,
  whose `adopt()` bumps `draftRev` unconditionally and would report true.
- **`insertReference`** — same re-scan. A chip insert always changes the draft,
  so this is a real observation rather than a tautology; the CAS-miss and
  bounds paths return false without mutating.
- **`consumeToken`** — span guard: CAS, `start !== end`, then the re-scan.
  Bare-token guard: `draft.trim() === token` and token non-empty, then asserts
  the draft actually became empty *and* was not already empty.
- **`beginCommand`** — the one verb whose "applied" is not purely textual,
  because entering command mode is itself the mutation. Answer =
  guards passed **and** the observed post-condition
  `$scanDraft().draft.startsWith(claim.token)` holds after the transaction.
  That keeps a legitimately-no-op splice (draft already read `/goal `) truthful
  as `true` — the input really is claimed — while a rejected transaction
  (stale CAS, non-leading span) leaves the draft unchanged and fails the check.
  The claim is written to `CommandClaimStore` only when the answer is true.

Tested in both directions:
`packages/ui/src/chat/composer/__tests__/trigger-editor-ops.test.ts` (17 cases,
including the explicit no-op-splice-answers-false case) and
`plugins/dsh-plugin-ui-shell/src/client/input-trigger-bridge.test.ts` (9 cases,
including "no editor bound ⇒ no listener ⇒ bail sees undefined").

---

## How home-composer and in-session menus share ONE implementation

`TriggerMenu` is the only menu component, and it owns the pixels, the keyboard
and the highlight on both paths. Only the DATA source differs:

| | in-session | session-less (home draft, Quick-Ask, extension) |
| --- | --- | --- |
| detection | official `InputTriggerController.track` | `triggers/detect.ts` (byte-faithful mirror; the official one is not exported) |
| candidates | `controller.menu` store | surface-local provider registry |
| menu component | `OfficialTriggerMenu` → `TriggerMenu` | `TriggerMenuPlugin` → `TriggerMenu` |
| sources | the same `InputTriggerSource` objects | the same objects via `sourceToProvider` |
| pick application | bail listeners → `editor-ops` verbs | `applyPickOutcome` → the same verbs |
| group headings | `TRIGGER_SOURCE_LABELS` | `TRIGGER_SOURCE_LABELS` |

The choice is made in exactly one place — `TriggerMounts` in
`RichComposerEditor.tsx` — and it is **exclusive**: `session.official` mounts
`OfficialTriggerPlugin` (driver only, contributes no menu; the menu comes from
the shadowed seat), otherwise `TriggerMenuPlugin` (detector + menu). So
"exactly one menu in-session" is constructive, and asserted: the pipeline test
counts `[data-composer-overlay]` in the whole document and requires 1. Verify
pins the exclusivity too (mutation M16).

Quick-Ask is unchanged: it passes no `triggerRuntime`, `official` is false, and
the local path runs over the same sources.

---

## Step-4 styling decision: SHADOW, not a `--dsw-*` bridge

I evaluated the bridge seriously and rejected it on evidence, not taste.

The trigger menu alone might have been bridgeable: `MenuView.module.css` ships
real rules inside `ui-input-trigger`'s bundle and consumes 9 `--dsw-*` aliases.
`PopupSelectView` likewise ships real rules and consumes 9.

But the popup is not just that shell. Acceptance criterion 2 requires the
**shared confirmation gate**, and that is
`RiskConfirmation` from `@deepseek-ai/dsh-client-ui-primitives` — a package
which ships **all 23 of its CSS modules STUBBED**:

```
$ grep -c 'dsh-css-stub' …/dsh-client-ui-primitives/lib/index.js
23
$ grep -c 'data-plugin-css' …/dsh-client-ui-primitives/lib/index.js
0
…/lib/index.js:2071  //#region \0dsh-css-stub:./RiskConfirmation.module.css.mjs
…/lib/index.js:2072  var RiskConfirmation_module_css_default = {};
```

Every export is `{}`; the rules live only in the official web frontend bundle,
which Amiba does not serve. A token bridge would have painted the popup card
and left the confirmation modal a bare stack of unstyled divs with
`className=""` — half-styled, which the brief forbids. The tokens are only half
the gap, and the gate has no rules to receive them.

So: **shadow both**, with Amiba's own `CommandPopup` reproducing the shell over
the official `PopupSelectController`. What is shadowed is pixels only —
single-flight select, retry-on-failed-load, local filtering, the
acknowledge-then-confirm gate, post-select token consumption and composer
refocus are all the official controller's logic. `filterOptions` is mirrored
(one small pure function, cited) because `dsh-client-ui-commands` is a plugin
bundle `@amiba/ui` may not pull runtime code from.

Mechanism: same `id`, `priority: -1` against the official entries' implicit
`0`. `SlotCore.entriesOfSlot` (`dsh-client-ui-slots/lib/index.js:179-194`)
keeps the first entry per cell in ascending-priority order, so exactly one
renders per cell.

Both themes / accents: `CommandPopup` and `OfficialTriggerMenu` use only
Amiba's semantic tokens (`bg-popover`, `text-popover-foreground`,
`border-border`, `bg-accent`, `text-destructive`, `shadow-popover`) and the
existing `Input` / `Button` / `Checkbox` primitives — the same vocabulary
`TriggerMenu` has always used. Light/dark and every accent therefore follow the
accent-theme system by construction rather than by a hand-tuned palette. I did
NOT visually verify four rendered permutations (see Concerns).

---

## Tests

`pnpm -r test`: **559 passed, 0 failed** (packages/ui 314, ui-shell 23).
New coverage:

- `trigger-editor-ops.test.ts` — 17: applied-truth of all four verbs in both
  directions; U+FFFC placement and the separating-space rule; the leading-span
  refusal; the claim integrity watch.
- `trigger-pipeline.test.tsx` — 6: a fixture plugin source's group appears in
  Amiba's menu; a pick lands a chip; `codec.serialize` output is what reaches
  `onSubmit`; a missing codec blocks the send and surfaces the reason; exactly
  one `[data-composer-overlay]` in-session; a claim routes Enter through its own
  submit, clears on success, and never sends the draft as a message.
- `CommandPopup.test.tsx` — 6: rows, select routing, the confirmation gate
  (disabled until acknowledged), closed-renders-nothing, retry, and the
  `filterOptions` mirror.
- `input-trigger-bridge.test.ts` — 9: the four listeners true/undefined,
  listener lifetime, source registration + disposal, scope-less session as an
  empty seat, and the real-`actx` claim submit.
- `dsh-providers.test.ts` — rewritten onto the sources: candidates, `onPick`
  outcomes, codecs, the leading-only policy, the `officialTriggerSources`
  roster, and the reject-don't-downgrade resolver rule.
- `trigger-detect.test.ts` — rewritten for the mirrored detector including the
  guard tiers and the URL / word-char carve-outs.

Gates, all green: `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test`,
`node scripts/verify-dsh-architecture.mjs`,
`node scripts/verify-pluginization.mjs --strict-i18n`,
`pnpm install --frozen-lockfile`.

## Mutation checks

18 mutations against the new verify assertions; script kept at
`/private/tmp/.../scratchpad/mutate.sh` (out of repo). **18/18 caught after one
fix.**

Covered: shadow priority flipped to 0; each shadow id renamed; the registration
dropping `priority`; each of the four bail listeners replaced by a bare `true`;
the claim submit given a fabricated ctx; `track` / `onSpace` / `bindEditor` /
the integrity watch removed; `onSpace` moved onto a Lexical command;
`adjudicate` removed; codec resolution removed; both mount paths rendering; a
duplicate `('/', "command")` source registered.

**The one that initially slipped:** the codec-resolution check was a bare
`/trigger\.resolver/` and the identifier also appears in a prose comment eleven
lines above the call — the same class of gap the tool.call.toolview review
recorded. Re-pinned inside the `expandMentionsAsync(value, providerRegistry.all,
trigger.resolver,` call; re-run, caught.

Separately, the **smoke pin is mutation-proven live**: reverting
`bundles/dsh-bundle-amiba-web/cordis.patch.yml` to the disabled state and
running `smoke.mjs` against a live server fails at exactly the new assertion
(`@deepseek-ai/dsh-client-ui-input-trigger must stay in the client graph`),
while with the patch applied the assertion passes — i.e. both rows really are
in the served client graph.

---

## Concerns, recorded honestly

1. **`arbitrate` is deliberately not driven.** It is a menu-internal keyboard
   helper — its whole body touches only the menu store and `pick`
   (`ui-input-trigger/lib/client.js:356-382`) — with no `InputTriggerSource`
   member reachable only through it. Amiba's `TriggerMenu` owns the keyboard on
   both mount paths (↑↓ across groups, Tab to switch group, Enter, Esc);
   routing arrows through `arbitrate` would give the in-session menu a
   different highlight model than the home composer's, which is the exact
   divergence this design exists to prevent. Escape and outside-pointerdown do
   reach `controller.dismiss()`, which is byte-identical to
   `arbitrate('escape')`. Documented in the SDK, both READMEs, the bundle patch
   and the architecture doc. If upstream ever hangs a source callback off
   `arbitrate`, this must be revisited.

2. **A second detector implementation exists.** `detectTrigger` is not exported
   by `dsh-client-ui-input-trigger` (its `files` list ships only
   `lib/{index,invariant,client}.js` plus declarations), so the session-less
   path needs its own. `triggers/detect.ts` is a byte-faithful port with the
   source cited, following the P1 `shell.overlay` mirror precedent — but unlike
   that one it has **no drift guard**, because there is no importable
   declaration to type-probe against. If upstream changes the algorithm, the
   two mounts would silently disagree. A future guard could diff the ported
   function against the built bundle's text.

3. **One user-visible behaviour change from the official detector.** It is not
   line-anchored, so a mid-line `/` is now a hit (`position: "inline"`) where
   Amiba's old regex produced nothing. Amiba's own `/` sources answer `[]` for
   inline positions, so the BUILT-IN behaviour is unchanged — but `ui-commands`
   applies its own upstream policy (leading, or any command without an input
   hint), so a mid-line `/` can now open a Commands group. That is a newly
   enabled plugin's behaviour, not a regression of Amiba's.

4. **The in-session `/` catalog now comes from `ui-commands`, not Amiba's
   `agentCommands` provider.** Same underlying DSH command registry, but the
   rows are synthesized by the official source, and commands with an input hint
   now enter command mode instead of inserting text. This is the feature, not a
   defect — but it IS a change in what `/` does in-session, and the home
   composer (which keeps Amiba's own `command` source) therefore lists commands
   slightly differently from an in-session composer. Recorded in the
   architecture doc.

5. **The menu's anchor moved slightly in-session.** The shadowed seat renders
   as the last child of `[data-composer-card]`, so the menu floats above the
   whole card rather than above the editor line (where `TriggerMenuPlugin`
   still puts it on the home composer). That is the seat's own contract
   (`bottom: calc(100% + 4px)` against the card) and both official occupants
   assume it, but it is a small visual difference between the two mounts.

6. **No end-to-end live smoke of the rendered menu.** `runtime:prepare` cannot
   complete in this worktree: staging runs `npm install` against the live
   registry, which now serves `@deepseek-ai/dsh-llm@0.1.0-rc.8` while Amiba
   pins the `rc.6` set, and npm fails ERESOLVE on
   `peer @deepseek-ai/dsh-attachment@^0.1.0-rc.8`. This is **pre-existing and
   unrelated** (both packages are host-side and untouched here); the main
   checkout works only because it holds a staged copy from before the drift. I
   borrowed that copy to run `smoke.mjs` and got the two results in the
   Mutation-checks section above, then deleted the hand-assembled staging
   rather than leave an incoherent artifact. The `smoke.mjs` run does not reach
   completion in that borrowed configuration — it fails later at an unrelated
   `@amiba/dsh-plugin-catalog bundled Amiba's host-only PlatformAdapter
   singleton` assertion, which I proved is **independent of this phase** by
   reproducing it with the pristine ui-shell bundle in place. So: the two rows
   are confirmed live in the client graph, but the menu/popup have not been
   clicked in a browser, and neither has the light/dark/accent rendering.
   **Recommended before merge:** a live pass on the main checkout —
   `pnpm runtime:rebuild` + restart, then (a) `/` and `@` on the home composer,
   (b) the same in-session with exactly one menu in the DOM, (c) a `/command`
   with an input hint entering command mode, (d) the popup and its confirmation
   gate in light + dark + two accents.

7. **`TriggerMenu`'s hard-coded Chinese copy** ("加载中…", "无匹配结果",
   footer hints) and `CommandPopup`'s defaults are literals, not i18n keys —
   inherited from the existing component, not introduced here, and left alone
   to avoid touching the `--strict-i18n` surface in this phase.

8. **`ObservableSnapshot` vs `SnapshotStore`.** The composer's controller face
   types `menu` as the read-only `ObservableSnapshot`, which is a strict
   widening of the real `SnapshotStore` — safe, and it keeps the composer from
   ever writing to a store it does not own.
