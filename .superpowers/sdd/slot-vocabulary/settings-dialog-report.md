# `settings.*` — all seven adoptable seats, and the dialog that makes them honest

Branch `worktree-agent-a5dbb7a719a8014a8`, base `main @ e5ddeac`. Six commits,
none pushed, none merged.

| commit | scope |
| --- | --- |
| `d3a1ee7` | `feat(sdk)` — vocabulary: six new owner contracts + derivation probes + the not-adopted record |
| `b833433` | `feat(ui)` — dialog container, seat render sites, onboarding coordinator |
| `386de40` | `feat(ui-shell)` — declarations, dispatches, view→dialog swap, active-fact wiring |
| `57de927` | `test(settings)` — 44 cases across the two packages |
| `2e65693` | `docs(slots)` — verify assertions + three docs |
| (this file) | the report |

**Status: all three tasks landed.** Seven of the eight official `settings.*`
names are declared and dispatched; the eighth (`settings.plugins.tab`) is
refused with evidence. Nothing was faked.

---

## 1. What the official shell actually is, and what Amiba took from it

Read from the installed bundle, not from the brief:
`@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:60-232` (`SettingsRoot`
+ `SettingsPanel`), with the slot contract at
`@deepseek-ai/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts`.

The brief's summary was accurate with one correction worth recording: it said
`settings.action` "takes NOTHING". It does take nothing, but not through its own
interface — `settings.header`, `settings.action` and `settings.close` all share
one owner type, `SettingsHeaderOwnerProps { children?: never }`
(`slots.d.ts:36,50,131`). Three seats, one contract. That is why the SDK
re-exports one interface and the derivation probe compares three seats against it.

Kinds, verified rather than assumed — this is the half that would have broken
silently:

| seat | kind | scope |
| --- | --- | --- |
| `settings.trigger` | **single** | root |
| `settings.header` | **single** | root |
| `settings.action` | list | root |
| `settings.close` | **single** | root |
| `settings.section` | list | root |
| `settings.onboarding` | list | root |
| `settings.general.item` | list | root |
| `settings.plugins.tab` | list | root |

**Three of them are `single`.** That single fact drove a design decision the
brief did not anticipate: `SlotCore.register` throws when a second entry lands
on an occupied cell at the same priority (default 0) —
`dsh-client-ui-slots/lib/types/index.d.ts:544-548`. Upstream can register its own
`TriggerContent` / `HeaderContent` / `CloseLabel` because upstream IS the shipped
composition. If Amiba did the same, the first third-party
`ctx.slots.register({ name: "settings.trigger" }, …)` would **throw** — the seat
would be declared and permanently unusable.

So Amiba registers **nothing** into the three single seats and passes its own
content as the dispatch `fallback` instead. Same rendered result when unoccupied,
but the cell stays free. This is recorded in the SDK README, the ui-shell README,
and pinned by verify (mutation M13).

---

## 2. Task 1 — Settings is now a dialog

`type View = "chat" | "settings"` is gone. `AmibaProductShell` renders the chat
tree unconditionally and layers `@amiba/ui`'s `SettingsDialog` over it.

Structure reproduced from `SettingsPanel`: `role="presentation"` overlay,
`aria-hidden` mask that closes on click, `role="dialog" aria-modal="true"` panel
named through `aria-labelledby` at the navigation heading, and a document-level
Escape listener whose lifetime is the panel's. The trigger carries
`aria-haspopup="dialog"` and a live `aria-expanded`.

Amiba's visual design and page framework are untouched: `SettingsView`,
`SettingsPageScaffold`, `PaneHeaderBar`, `page-chrome`, and the page registry all
render inside the panel exactly as before. The only edits to them are additive
optional props and one `h-screen` → `h-full` on the `SettingsView` root, because
the panel now owns the height.

**One deliberate departure from upstream, stated plainly.** Upstream focuses its
close button on `SettingsPanel` mount and restores nothing on close. Amiba's
scaffold remounts per navigation (`key={route.tab}`), so auto-focusing a per-page
control would steal focus on *every* nav click. The panel itself takes focus on
open (`tabIndex={-1}`) and the element that was focused when it opened gets focus
back on close — which satisfies the brief's "focus returns to the trigger" for
the sidebar path and for every other entry path too.

**Also deliberately dropped: the drag regions.** The old settings view passed
`app-drag-region` on the sidebar header and the pane header. Inside a floating
dialog that would make parts of the panel drag the OS window; the chat surface
behind it keeps its own drag region, so nothing is lost.

### How hash deep-linking survives

Section addressing still has exactly one source — the URL hash — and
`SettingsView`'s routing (`routeFromLocation`, the `hashchange` listener, the
`dsh:<id>` fallback for unknown bare ids) is **unchanged**. What changed is only
who is mounted:

- **Dialog closed** → `SettingsView` is unmounted. `useSettingsShell.openAt(id)`
  writes `#dsh:<id>` with `replaceState` *before* setting open, so `SettingsView`
  reads the fresh hash in its `useState` initialiser as it mounts.
- **Dialog already open** → `SettingsView` is mounted and only listens for
  `hashchange`. `replaceState` fires no such event, so `openAt` dispatches a
  synchronous `HashChangeEvent`. This synthetic dispatch already existed in the
  old handler; it is now load-bearing for a second case.

Every entry path funnels through the same `open-settings` layout action, and
therefore through `openAt`:

| entry path | route |
| --- | --- |
| sidebar settings row | `openSettings()` prop → `settings.openAt()` (no section; last hash wins, as before) |
| settings navigation section rows | `openSettingsSection(id)` → `ctx.layout.openSettings(id)` → event → `openAt(id)` |
| any plugin's `ctx.layout.openSettings(id)` | same |
| `HomeView` gear | `settings.openAt()` |
| `ErrorBlock` recovery (`ChatSurface.tsx:312`) | `openSettings(tab)` writes the raw registry hash (`models` / `connection` / `logs`) then `openAt()` — SettingsView resolves an unknown bare id against the ledger, as it always did |
| command palette | `openSettings()` |
| onboarding `openSection(id)` | `openSettingsSection(id)` — the same affordance the nav uses |

Tested end to end in
`plugins/dsh-plugin-ui-shell/src/client/settings-shell.test.tsx` (7 cases,
including the already-open re-address and the exactly-one synthetic
`hashchange`).

Quick-Ask is untouched: it renders neither `FullScreenChatView` nor
`SettingsView`, passes no `settingsTrigger` renderer, and every new prop on the
`@amiba/ui` side is optional with the previous behaviour as its default.

---

## 3. Task 2 — the onboarding coordinator

### What I mapped official `blank` onto, and why it is equivalent

**I did not map it. I read the same store.**

`useSessions` is a member of `GlobalStandardProps`
(`dsh-client-runtime/lib/types/client/index.d.ts:86-88`) — the framework puts it
on the props of *every* slot component, including Amiba's `root` occupant. It is
a selector hook over the official `SessionListState`, the very store upstream's
`SettingsRoot` reads. So the predicate is upstream's, verbatim, over upstream's
snapshot:

```ts
// plugins/dsh-plugin-ui-shell/src/client/settings-onboarding.ts
state.phase === "ready" &&
(state.current === undefined || state.byId[state.current]?.blank === true)
```

The governing rule says to use the official service when one exists, and one
does. Re-deriving an "Amiba equivalent" from `useSessions()` in
`@amiba/app-runtime/core` would have been a second, weaker definition of a fact
the official service already publishes.

That said, the brief asked what each arm means in Amiba's terms, and the answer
is what makes this honest rather than lucky:

- **`phase === "ready"`** — the host session list has landed at least once.
  Before that Amiba is still booting.
- **`current === undefined`** — **this is Amiba's home/draft view.** The R1
  sessions bridge (`sessions-bridge.ts`, Phase 2) projects Amiba's own `activeId`
  onto the official selection and calls `ctx.sessions.clear()` whenever `activeId`
  is `""` — which is precisely the state `resolveChatSurfaceMode` calls `"home"`
  (`ChatSurface.tsx:329`). Amiba's selection is authoritative (the P2 coordinator
  ruling), so official `current` *is* Amiba's selection.
- **`blank === true`** — the host's own empty-log bit, documented as "blank
  sessions are reused by New Session instead of minting another"
  (`sessions/service.d.ts:52-57`). Amiba's freshly created, never-submitted task
  is exactly such a row; the bit flips to false on the first accepted prompt
  (`sessions/session.d.ts:19-23`), i.e. the moment the draft stops being a draft.
  Amiba's own `SessionMeta.messageCount` would have been the hand-rolled
  equivalent — and a worse one, since it is a cached presentation count, not the
  host's derivation.
- **a `current` the list does not carry** answers false, as upstream's optional
  chain does.

### Rules 2–6

In `packages/ui/src/settings/onboarding.ts` (`useOnboardingCoordinator`) and the
dispatch site:

2. active step = `steps.find(step => !completed.has(step.id))` — first
   **registered** step not yet completed, in ledger order (`order` ascending,
   projected in `index.tsx` the same way the `settings.section` ledger is).
3. rendered with `{ only: onboardingStepId }`, so one-at-a-time is structural.
4. `complete()` adds the id and the next entry takes over.
5. `openSection(id)` = `openSettingsSection` = `ctx.layout.openSettings(id)`, the
   same affordance the settings navigation uses.
6. **completion is not persisted**: an effect keyed on `active` clears the whole
   set whenever it is false.

**On rule 6 — I copied it, and I do think it is wrong.** A user who completes
step A, sends a message (active → false), and later opens a new blank session
sees step A again; nothing anywhere records that the step was done. It is defensible
only if steps are meant to be idempotent nudges rather than one-time setup. But
upstream owns the flow's semantics: a third-party step written against the
official shell would behave differently under Amiba if I "fixed" it here, and
that divergence is exactly what this vocabulary policy exists to prevent. So it
is copied, documented as copied, and verify actively **bans** adding persistence
(mutation M34). If it should change, it should change upstream first.

Amiba ships **no onboarding steps of its own**, as instructed. The coordinator
and the seat are the deliverable. I considered adding one (a "connect a model"
nudge) and did not: with no persistence it would re-appear after every message
on a blank session, which would be an annoyance shipped as a demo.

---

## 4. Task 3 — the remaining five, and the `settings.plugins.tab` verdict

| seat | render site | owner supplied |
| --- | --- | --- |
| `settings.header` | the settings navigation heading (`SettingsView`'s sidebar top), which also carries the id the dialog is named after | `{}` — the contract's empty marker |
| `settings.action` | `SettingsPageScaffold`'s `trailing`, **before** the `data-settings-page-actions` portal container | `{}` |
| `settings.close` | the dialog close button's `sr-only` label, last in the trailing cluster | `{}` |
| `settings.trigger` | the sidebar settings row's body | `{ wide }` — the real sidebar column state (`!sidebarCollapsed`), threaded from `FullScreenChatView` through a render prop |
| `settings.general.item` | last child of the Appearance page's row stack (Amiba's General section) | `{}` |

**The action seat and the portal coexist**, as required. `trailing` became a
fragment: `{actions}` → the `data-settings-page-actions` div (unchanged, same
attribute, same ref) → `{closeControl}`. The portal is the in-tree channel a page
uses for its own head controls (`SettingsPageActions`, which crosses plugin
bundle copies via the realm-registry context); the seat is the out-of-tree
channel a plugin registers once for every page. Ordering matches upstream's
"actions rendered in the content-column header **before Close**". Tested both
present simultaneously.

**`settings.trigger` needed one new mechanism**: `NavigationRow` grew an optional
`body` prop that replaces the icon+label pair while keeping the button chrome.
Without it the seat could only have occupied the label column, which would have
been a quiet divergence from "icon + label, supplied as slot content". Amiba's
own body (`SettingsTriggerContent`) is one implementation shared by the fallback
and by hosts with no plugin runtime, so the two cannot drift.

### `settings.plugins.tab`: NOT adopted

The owner share is empty, so supplying it is trivial — which is exactly why the
decision cannot rest on it. The contract is a **structure**:

> "The section owner renders localized entry labels as **tabs** and mounts each
> contribution inside its **corresponding tab panel**. Options: `id` (tab key),
> `order` (tab order), and `label` (registrant-localized tab text)."
> — `dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:72-80`

Amiba's Plugins page is `@amiba/ui`'s `DshPluginInventory`. Evidence that it is
not a tabbed structure:

- `DshPluginInventory.tsx:64` — `type PluginFilter = "all" | "amiba" | "dsh" | "failed"`.
- `:264-280` — `filtered` is one `entries.filter(...)` over a **single** dataset,
  combining the active filter with the page's one search box.
- `:500-519` — the control renders four `<button aria-pressed={...}>` elements,
  each with a count badge; there is no `role="tab"`, no `role="tabpanel"`, no
  per-tab body.
- `:528-576` — one table renders below, whatever the filter is.

There is no panel to mount a contribution into. Adopting the name would let an
entry written against the upstream contract type-check and then render inside
somebody else's filtered table — the precise failure mode the vocabulary policy
forbids. The type stays exported (`SettingsPluginsTabOwnerProps`) so adoption is
a one-line declaration the day the page grows real tab panels.

---

## 5. Tests

`pnpm -r test`: **603 passed, 0 failed** (was 559 on `main`; +44).

| suite | cases | what it holds |
| --- | --- | --- |
| `packages/ui/.../SettingsDialog.test.tsx` | 7 | renders nothing while closed; modal + named; `aria-expanded` on the trigger; Escape (and NOT while closed); mask click closes, inside click does not; focus taken on open, returned on close |
| `packages/ui/.../settings-seats.test.tsx` | 9 | each seat's placement, both occupied and unoccupied: header in the nav heading + as the dialog's name, action before the portal and coexisting with it, close label from the seat and from the fallback, no close control outside the dialog host, general.item as the LAST row of the General stack and absent from other pages |
| `packages/ui/.../onboarding.test.tsx` | 8 | one at a time; advance; **registry order beats completion order**; inactive mounts nothing; the reset; idempotent + unknown-id completes; late registration; stable `complete` identity |
| `plugins/.../settings-onboarding.test.ts` | 6 | every arm of upstream's predicate, including a `current` the host list does not carry |
| `plugins/.../settings-shell.test.tsx` | 14 | the open-settings action end to end (address, re-address an open dialog with exactly one synthetic `hashchange`, no-section open leaves the hash alone, unrelated actions ignored, listener removed on unmount) + a fixture plugin's two steps one-at-a-time over the official sessions store, the blank→non-blank transition, the reset, late registration, and `openSection` |

Acceptance criterion 2 ("a fixture plugin registering into each newly declared
slot renders in the right place") is covered by `settings-seats.test.tsx`: the
nodes it passes are what `renderSlot` hands the host, and the assertions are
about placement — the half of a slot contract types cannot check.

---

## 6. Mutation checks

Every assertion I added was broken, the gate re-run, and restored. **38
mutations: 37 expected-to-be-caught, all 37 caught; plus 1 negative control that
correctly did not fire.**

The first pass ran 36 and **caught only 32**. The four escapes were worth the
exercise:

- **M21 / M22 — two REAL gaps.** `role="dialog"` and `aria-modal="true"` were
  pinned with a bare regex over the raw source, and `SettingsDialog.tsx`'s own
  doc block *quotes both strings while explaining them*. Deleting the attributes
  from the JSX left verify green. Same class as the P3 collapsing-row gap that
  slipped past three prose mentions. Fixed with a `code()` comment stripper,
  applied to the four files whose pins overlap their own vocabulary (the dialog,
  the predicate, the settings shell, the coordinator). Re-mutated as M21b/M22b —
  now caught.
- **M28 / M29 — harness artifacts.** `settings-onboarding.ts` quotes upstream's
  selector verbatim in its doc block, so my `String.replace` hit the *comment*
  first. Re-targeted at code-only anchors (M28/M29) and re-run: caught. M29c
  (replace the whole function body with `return true`) is also caught, which is
  the check that actually matters.
- **M29b** is a deliberate **negative control**: editing only the prose must NOT
  fail verify. It doesn't. Recorded here so the "not caught" line in the harness
  output is not mistaken for a gap.

Full ledger:

| # | mutation | result |
| --- | --- | --- |
| M1–M3 | children-table membership removed (`trigger`, `onboarding`, `general.item`) | caught |
| M4–M7 | kind/scope drift (`single`↔`list`, `root`→`session`, incl. `settings.section`) | caught |
| M8–M11 | fabricated owner member on each of the four empty-owner dispatches | caught |
| M12 | `settings.trigger` owner hard-coded to `{ wide: true }` | caught |
| M13 | `settings.trigger` fallback dropped (sidebar row would go blank) | caught |
| M14–M17 | onboarding dispatch: `only` filter, `stepId`, `complete`, `openSection` | caught |
| M18 | the `type View = "chat" \| "settings"` route swap reintroduced | caught |
| M19 | dialog no longer named after the nav heading | caught |
| M20 | dialog open state detached from the shell | caught |
| M21b–M27 | dialog semantics: aria-modal, role, aria-labelledby, closed-renders-nothing, Escape, mask click, focus restore | caught |
| M28–M30 | rule 1: blank bit inverted, readiness gate dropped, no-current arm dropped | caught |
| M29c | the predicate replaced wholesale with `return true` | caught |
| M31 | active fact no longer read through the official `useSessions` hook | caught |
| M32 | rule 2: registry order reversed | caught |
| M33 | rule 6: the reset dropped | caught |
| M34 | rule 6: persistence added instead | caught |
| M35 | SDK probe: a `settings.*` key that never merged into `SlotMap` | caught (tsc) |
| M36 | SDK probe: owner derivation narrowed away from the official interface | caught (tsc) |
| M29b | *(negative control)* prose-only edit | correctly not caught |

---

## 7. Gates

| gate | result |
| --- | --- |
| `pnpm -r build` | pass |
| `pnpm -r typecheck` | pass (incl. the extension-sdk drift guard program) |
| `pnpm -r test` | **603 passed, 0 failed** |
| `node scripts/verify-dsh-architecture.mjs` | pass |
| `node scripts/verify-pluginization.mjs --strict-i18n` | pass (336 files) |
| `pnpm install --frozen-lockfile` | pass |

Cold-worktree bootstrap needed `pnpm --dir packages/app-runtime build:dsh-runtime`
between a first `pnpm install` (which fails `apps/cli prepare`) and a second —
the pre-existing gap recorded in P3 note N6 and the toolview note N6.

---

## 8. What I refused to fake

- **`SettingsPluginsTabOwnerProps` is exported but the seat is not declared.**
  Supplying its (empty) owner would have been free; the structure it requires
  does not exist. §4.
- **`useOfficialSessions` is a REQUIRED prop, not optional.** Optional would have
  meant either a conditional hook call or a fabricated `SessionListState` standing
  in for the real store when absent. The framework puts `useSessions` on every
  slot component's props, so the one construction site always has it.
- **No Amiba registration in the three `single` seats.** The tempting move — mirror
  upstream and register `TriggerContent`/`HeaderContent`/`CloseLabel` — would have
  looked more official and made every third-party registration throw.
- **No `settings.plugins.tab`-shaped tabs bolted onto the Plugins page** to make
  adoption possible. That would be redesigning a page to fit a slot.
- **Rule 6 not "improved".** §3.

## 9. Concerns

1. **Not live-smoked.** Everything here is unit-level and gate-level. The
   view→dialog change is a container change to the app's second-most-used
   surface, and three things specifically want a real run: (a) the panel's
   geometry (`h-[min]` / `max-w-[1180px]`) against the real settings pages,
   especially the `scroll="self"` sections; (b) the desktop chrome — I removed
   `app-drag-region` from the settings headers, which is right for a dialog but
   changes how the window drags while settings are open; (c) the `settings.header`
   row replacing the old empty desktop spacer.
2. **`useOnboardingCoordinator` lives in `@amiba/ui`, the predicate in ui-shell.**
   Rules 1 and 5 sit in the plugin (they need the official types and the layout
   service); rules 2, 4 and 6 sit in the UI package (pure React). The split is
   by dependency, not by concept, and the coordinator's rules are therefore
   documented in two places. `settings-shell.ts` is the seam that joins them and
   is where the end-to-end test lives.
3. **`settings.trigger`'s `wide` is honest but currently unexercised.** Amiba's
   collapsed sidebar animates to width 0 with `inert`, so no rail state actually
   renders a narrow trigger. The owner value is the sidebar's real state either
   way, and `SettingsTriggerContent` honours it (`sr-only` label when narrow) so
   the seat's contract is kept rather than merely typed — but nobody has seen it.
4. **The dialog is not a focus TRAP.** Focus is taken on open and returned on
   close, and Escape/mask close, but Tab can still reach the chat surface behind
   the panel. Upstream's panel is not a trap either (it installs no trap; only
   onboarding steps take `#root` inert ownership), so this matches — but
   `aria-modal="true"` promises more than the DOM delivers on both sides.
5. **`@testing-library/react` is now a ui-shell devDependency.** One new dev
   dependency on a plugin package, to make the settings-shell seam testable
   without mounting `FullScreenChatView`. The package runs vitest without
   `globals`, so RTL's auto-cleanup does not register and the suite calls
   `cleanup` explicitly — a footgun for the next test file added there.
6. **`SettingsView`'s non-`onGoHome` branch changed.** The standalone-options
   header (logo 28 + `app.title` at `h-14`) became the unified navigation heading
   (logo 20 + the `settings.header` seat at `sidebarHeaderHeightPx`). Nothing in
   the repo renders `SettingsView` without `onGoHome` today, so this is only a
   latent difference for a future host.
7. **The nav ledger still draws its own rows.** Upstream's shell also draws nav
   rows from the `settings.section` ledger, so this is not a divergence — but it
   means a section's nav row is host-rendered while its page is registrant-rendered,
   and Amiba's vendor `navIcon` convention remains the only way to influence the
   glyph.
