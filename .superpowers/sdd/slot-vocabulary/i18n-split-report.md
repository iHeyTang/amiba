# Splitting the dictionary: dead keys deleted, owners separated, one namespace

Branch `worktree-agent-a6dc5a78484a51357`, base `main @ fe46e4c`. Nothing
pushed, nothing merged.

| commit | scope |
| --- | --- |
| `569470e` | `refactor(i18n)` — delete the 255 keys with no production call site |
| `82523dc` | `refactor(i18n)` — move each dictionary to its owner, register one namespace |
| (this file) | `docs(locale)` — the report |

**Status: both parts landed. Every gate green.** Parts 1, 2 and 3 of the brief
are all done; §9 lists what I refused to fake and §10 the concerns.

---

## 1. Part 1 — the 255 dead keys

The census (the previous agent's method, re-run verbatim: every dotted string
literal in `packages/`, `plugins/`, `apps/`, `bundles/`, `scripts/`, `docs/`,
intersected with the keys parsed out of `en.ts`, owner = the set of workspace
projects whose non-test files mention it) reproduced its numbers exactly:

```
443 packages/ui              23 dsh-plugin-model-plane      9 apps/desktop
247 UNUSED                    8 TESTONLY:packages/ui        3 dsh-plugin-messaging-core
 …  (17 shared across ≥2 projects, 2 packages/app-runtime, 1 ui-shell)
total 753
```

247 unreferenced + 8 tests-only = **255 deleted from BOTH catalogs**, 498
survive. Re-running the census afterwards reports **zero** `UNUSED` and
**zero** `TESTONLY` rows — every remaining key has a production call site.

The 114 `options.extensions.*` went with the rest, per the user's decision.

Three section-header comments whose entire section died were removed or
reworded (`// Harness-independent model plane`, `// Extensions settings page`,
`// Home shortcuts strip`), so no comment names a family the file no longer
carries.

### 1.1 The 8 tests-only keys — what happened to each test

Every one of them was asserted **negatively**: `queryByText(key)` …
`not.toBeInTheDocument()`. The suites were asserting that a string no
production code can emit is absent from the DOM. I **fixed the tests** (deleted
the vacuous assertion statements) rather than deleting the test cases — every
case keeps all of its assertions that observe real rendered output. **No test
case was removed**; the suite count did not move (629 before, 629 after
Part 1).

| key | test | what I did |
| --- | --- | --- |
| `sidepanel.trace.fields.result` | `MessageChrome.test.tsx` "renders the file content" | deleted the one `not.toBeInTheDocument()` line |
| `sidepanel.trace.executionComplete` | `MessageChrome.test.tsx` "collapses the merged summary" | deleted the assertion |
| `sidepanel.trace.fields.command`, `.output` | `MessageChrome.test.tsx` terminal detail | deleted the two assertions |
| `sidepanel.trace.fields.url`, `.matches` | `MessageChrome.test.tsx` browser detail | deleted the two assertions |
| `sidepanel.trace.fields.name`, `.result` | `MessageChrome.test.tsx` skill detail | deleted the two assertions |
| `embeddedBrowser.expand` | `FullScreenChatView.test.tsx` workspace browser | deleted the assertion |

One more assertion went with them although its keys were in the *unreferenced*
247 rather than the tests-only 8: the
`for (const field of ["code", "output", "action", "target", "result"])` loop in
`MessageChrome.test.tsx` built its keys with a template literal, which the
census's literal scan cannot see, so all five landed in `UNUSED`. All five keys
are gone, so the loop asserted on nothing; deleted.

---

## 2. Part 2 — the owner split

### 2.1 Owner -> file

Assigned by the census's call-site table, not by prefix.

| owner | keys | dictionary | key-union type |
| --- | --- | --- | --- |
| `@amiba/ui` — component copy + the shared vocabulary plugin components reach through `usePluginT` | **488** | `packages/ui/src/locales/{en,zh-CN}.ts`, entry `packages/ui/src/locales/index.ts` = `@amiba/ui/locales` | `UiMessageKey` |
| `@amiba/dsh-plugin-ui-shell` — the app-shell's own copy | **1** (`app.initializing`, rendered by `product-shell.tsx`) | `plugins/dsh-plugin-ui-shell/src/client/locales/{en,zh-CN}.ts` | `ShellMessageKey` |
| `apps/desktop` — the Electron windows with no plugin graph | **9** (7 × `notifier.*` in `NotifierView.tsx`, 2 × `quickAsk.actions.*` in `QuickAskView.tsx`) | `apps/desktop/src/renderer/locales/{en,zh-CN}.ts` | `DesktopMessageKey` |

Keys used only by a plugin (`options.models.*` × 23 by model-plane,
`common.*` × 3 by messaging-core, …) stay in `@amiba/ui/locales`: they are UI
vocabulary rendered through `usePluginT`'s host fallback, and moving them into
each plugin's own overlay is the separate T11 plugin-local-dict migration, not
this task. `packages/app-runtime`'s two `labelKey` strings
(`channels.local` / `channels.unknown`, `core/channels.ts:20`) likewise stay in
the UI dictionary; app-runtime keeps only the key string, which is the
disposition the previous report proposed.

**One deliberate deviation from the brief, stated plainly.** The brief says the
shell's `apply` "imports each owner's dictionary and registers the merged
result". It merges TWO of the three: `@amiba/ui`'s and its own. `apps/desktop`'s
9 keys are not in the registration because (a) nothing in a plugin realm can
render them — every one of their call sites is inside the notifier or Quick-Ask
window, which boot no plugin graph — and (b) reaching them would mean a DSH
plugin taking a dependency on an Electron app, inverting the direction the
whole `plugins/` boundary exists to keep. Those 9 travel with their windows
instead, through the runtime-less path the brief's own exception describes. The
consequence is honest and bounded: `MessageKey` in a `packages/ui` program does
not include them, so a UI component cannot name one by accident.

### 2.2 The namespace, and where registration happens

**Namespace: `amiba`.** One string, one owner, one call site:
`plugins/dsh-plugin-ui-shell/src/client/messages.ts`.

```ts
export const AMIBA_LOCALE_NS = "amiba";
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap { amiba: AmibaLocaleKey }
}
locale.register(AMIBA_LOCALE_NS, toOfficialCatalog(amibaMessages));
```

`register` is the **typed** overload, which is why the declaration merge is
there: upstream checks the dictionary against the namespace's declared key
union (missing or extra key = compile error) and requires every shipped locale,
so both-language parity is compile-enforced at the registration site *as well
as* by each owner's own `Record<OwnKey, string>` annotation and by the merged
table's annotation. Three independent checks, none of them a lint.

`bind` is reached through a `string`-typed local, which selects upstream's
untyped `bind(ns: string): Translate` overload. That is deliberate and
documented: the realm resolver is handed every key any Amiba surface asks for,
including plugin-local keys `usePluginT` is *supposed* to miss on before
falling through to its own overlay's English. Upstream answers a miss with the
key itself — exactly what `useT` has always rendered.

Locale-id mapping reuses the existing pair. `toOfficialCatalog` (new, in
`@amiba/i18n`) asks `fromOfficialLocaleId("zh"|"en")` which Amiba catalog each
official id names, so the pairing is **derived, not asserted** — no cast. The
literal `zh`/`en` keys must exhaust `OfficialLocaleId`, which
`OfficialLocaleIdMatchesUpstream` already ties to upstream's `LocaleId`.

Wiring, in `apply`:

```ts
const disposeMessageCatalog = installAmibaMessageCatalog();          // unconditional
…
const messagesFiber = ctx.inject(["locale"], (scope) =>
  scope.effect(() => registerAmibaMessages(scope.locale), "…"));     // supersedes
```

Two installs, in that order, because `ctx.locale` is **optional** in this
composition — the shell's own long-standing comment says the product shell must
mount whether or not the locale row is in the graph, and "without them Amiba
simply keeps the browser-derived fallback, exactly as Quick-Ask does". Without
the first install that sentence would now mean "renders every string as its raw
dotted key". This is not a second mechanism: it is the documented runtime-less
path applied to a realm where the service happens to be absent, and
`installMessages`'s disposer restores the superseded source, so losing the
locale fiber falls back to the catalogs rather than to nothing.

The registration rides its **own** `ctx.inject(["locale"])` fiber rather than
the existing `["locale", "settingsScope", "connection", "remote"]` one: putting
a dictionary in the registry needs the locale service and nothing else.

### 2.3 Call sites did not change

`git show --stat` carries no change to any `useT()` call site or any
`t("…")` argument. The verify cross-reference counts **869** production
`t("…")` sites; the same 77 files call `useT()`. The two hooks' signatures,
`installOfficialLocale`, `seedDocumentLanguage`, `hasOfficialLocale`,
`getCurrentLanguage` and `subscribeLanguage` are all unchanged.

### 2.4 The mechanism: a second realm slot

`packages/i18n/src/messages.ts`, `Symbol.for("@amiba/i18n/messages")`:

```ts
interface MessageRegistry {
  resolve: MessageResolver | null;   // the realm's ONE template source
  epoch: number;                     // bumped on install/dispose
  readonly observers: Set<() => void>;
}
```

It is a **separate** slot from `Symbol.for("@amiba/i18n/official-locale")`
because the two facts have different installers: Quick-Ask installs a
dictionary and no locale source. Keeping them apart also left every assertion
and test the previous phase built around the official-locale slot untouched.

**All three members are realm-wide, which is the opposite of the boundary
`index.ts` keeps — and that is correct, not an oversight.** There, each copy's
`refreshLanguage` walks its own subscriber list, so a shared list would mean one
switch notifying each listener once *per bundle copy* (the M3/M5 failure the
previous phase documented). Here there is exactly one publisher — an install or
a dispose — which bumps once and walks the observer list once. One install, one
notification per observer, however many copies exist.

`messages.ts` has **no** dependency on `@amiba/app-runtime` and does not import
`./index.ts`. That is load-bearing: `dsh-plugin-runtime-inventory`'s bundle
contains `@amiba/i18n/plugin` but not `@amiba/i18n`, and routing the plugin
hook's fallback through `index.ts` would have pulled
`@amiba/app-runtime/platform` into it (measured: the platform realm symbol is
absent from that bundle before and after).

**The epoch is load-bearing.** The shell registers inside
`ctx.inject(["locale"], …)`, which resolves whenever the service does — quite
possibly after the product shell has rendered. A store snapshot carrying only
the language would be `Object.is`-equal across that install, React would bail
out of the re-render, and already-mounted trees would show raw keys forever.
`useT`'s snapshot is therefore `` `${language}#${epoch}` `` and `usePluginT`
takes a `useSyncExternalStore(subscribeMessages, …)` of its own. Upstream's
`LocaleRuntime.register` bumps its own `revision` for precisely this reason.
Mutation T1 reproduces the failure exactly.

`useT` asks the official service for the **template** and interpolates on
Amiba's side. The two interpolators differ on exactly one case — an explicitly
`undefined` param value: upstream prints `"undefined"`, Amiba leaves `{name}`
in place and `plugin.test.ts` pins that. Asking for the template only (upstream
returns it verbatim when `params` is absent) keeps every call site's behaviour
byte-identical while the dictionary, the lookup chain and the missing-key
policy are all upstream's.

### 2.5 Typing: declaration merging, upstream's own idiom

`MessageKey = keyof typeof en` had to go with `en.ts`. It is now

```ts
export interface AmibaMessages {}                    // @amiba/i18n
export type MessageKey = keyof AmibaMessages & string;
```

and each owner contributes a type-only augmentation beside its catalog
(`locales/keys.ts`), the same way upstream fills `LocaleNamespaceMap` and
`SlotMap`. `packages/ui/src/index.ts` and `src/plugin.ts` carry a bare
`import type {} from "./locales/keys"` so any program resolving `@amiba/ui`
gets the merge. `import type` is erased, so this does not weaken the
entry-point separation — and the proof of that is mechanical, not argued (§4).

A program that can see no owner resolves `MessageKey` to `never`, so every
`t("…")` in it becomes a compile error rather than silently widening to
`string`. `plugin.ts`'s `MessageKey | (string & {})` degrades gracefully for
plugin programs, which is what it was already for.

---

## 3. The exception: Quick-Ask and the notifier

`apps/desktop/src/renderer/locales/index.ts` merges `@amiba/ui/locales` with
this app's own window copy and exposes `installWindowMessages()`. Both entries
call it beside their existing `seedDocumentLanguage()`:

```
apps/desktop/src/renderer/quick-ask/index.tsx : seedDocumentLanguage(); installWindowMessages();
apps/desktop/src/renderer/notifier/index.tsx  : seedDocumentLanguage(); installWindowMessages();
```

Their bundles DO carry the dictionary — by design. Verified on the built
renderer: both `out/renderer/quick-ask/index.html` and
`out/renderer/notifier/index.html` preload the shared chunk that contains the
English sentinel, so the copy really is reachable from both windows.

The MAIN desktop renderer deliberately does not install: it boots the plugin
graph, so the shell's registration serves it, and importing the catalogs there
would add them to that bundle for nothing.

verify pins all of this (mutations M13/M14).

**Not live-tested**, and I am not going to pretend otherwise: Quick-Ask only
runs inside Electron behind the `window.amiba.dshClient` preload bridge, and
the brief explicitly rules out a live pass in this worktree. What backs the
claim is the built-artifact check above, the verify pins, and the mechanism
tests in §5 which exercise the identical runtime-less path (install catalogs
into a realm with no official source, render, assert real copy).

---

## 4. Part 3 — how bundle purity was PROVEN

Not from the source. `scripts/verify-dsh-architecture.mjs` reads the emitted
`plugins/<id>/lib/client.js` files.

The sentinels are dictionary **values**, not keys — a key literal also appears
at its call site, which legitimately IS in the plugin bundles:

```
"Unable to send your answer."   <- packages/ui/src/locales/en.ts
"无法发送你的回答。"              <- packages/ui/src/locales/zh-CN.ts
```

Three assertions, each with its own failure mode:

1. both sentinels must still be **in the catalogs** — otherwise the probe
   proves nothing and the whole check passes vacuously (mutation M9);
2. `dsh-plugin-ui-shell/lib/client.js` must **contain** them — it is the one
   bundle that must, since it imports every owner's dictionary to register it.
   This is the positive control (mutation MB2);
3. every other `plugins/<id>/lib/client.js` must **not** contain them
   (mutation MB1: a plugin value-imports `@amiba/ui/locales`, rebuild, caught).

With no built bundles present the block prints a loud SKIP rather than passing
silently (mutation MB3).

### 4.1 Before / after, measured at three points

Same probe, `pnpm --dir plugins/<id> build` at each commit.

| `lib/client.js` | base `main` fe46e4c | after Part 1 `569470e` | after Part 2 `82523dc` |
| --- | --- | --- | --- |
| `dsh-plugin-runtime-inventory` | 273,884 | 245,235 (−28,649) | **192,280 (−52,955)** |
| `dsh-plugin-ui-shell` | 2,441,434 | 2,412,783 (−28,651) | 2,413,167 (+384) |

`runtime-inventory` total: **−81,604 bytes, −29.8%**. The ui-shell column is
the attribution control: it keeps the dictionary, so it shows the dead-key
deletion (the same ~28.6 KB) and *not* the split — Part 2 adds 384 bytes there
(the registration modules) while removing ~53 KB from every other bundle.

Whole-repo census after Part 2 — the English sentinel's occurrence count in
each built client bundle (2 = en + zh present):

```
agent-preset      203,091  0      memory            257,930  0
catalog           259,457  0      messaging-core    283,626  0
mcp-manager       258,716  0      model-plane       431,229  0
runtime-inventory 192,280  0      schedule-adapter  272,771  0
skills            283,648  0      usage             278,391  0
ui-shell        2,413,167  2   <- the only one, and it must be
```

---

## 5. Gates, tests, and the acceptance criteria

| gate | result |
| --- | --- |
| `pnpm -r build` | pass |
| `pnpm -r typecheck` | pass |
| `pnpm -r test` | **647 passed, 0 failed** (629 at base; +18) |
| `node scripts/verify-dsh-architecture.mjs` | pass |
| `node scripts/verify-pluginization.mjs --strict-i18n` | pass (345 files) |
| `pnpm install --frozen-lockfile` | pass |

The brief's cold bootstrap order does not work on a fresh worktree and this is
the third report to say so: `build:dsh-runtime` needs `typescript` from
`node_modules`, which does not exist yet. What works is `pnpm install` (its
`apps/cli prepare` step fails, harmlessly, on the missing `dsh-runtime` dist)
-> `pnpm --dir packages/app-runtime build:dsh-runtime` -> `pnpm install`
-> `pnpm -r build`.

### 5.1 Tests added (+18)

`packages/ui/src/test/i18n-message-registry.test.tsx` — **9 cases** over the
realm message registry through both hooks: fail-loud with no source; a catalog
installed before the first render; **a catalog installed after mount repaints
an already-mounted tree**; a later install supersedes and its dispose restores;
an out-of-order dispose is a no-op; the resolver is asked at the asking copy's
language; and the three `usePluginT` counterparts (own overlay with no host
dictionary at all, fall-through to the realm, late-arrival repaint).

`plugins/dsh-plugin-ui-shell/src/client/messages.test.ts` — **7 cases**: the
merged dictionary carries exactly both owners' keys in both languages and takes
each string from its own owner; `registerAmibaMessages` registers ONE namespace
once, keyed `zh`/`en`, with the `zh` slot holding Amiba's `zh-CN` catalog (the
id mapping proven on the payload, not asserted); a second registration throws
through upstream's own duplicate rule; the bound translate becomes the realm's
source; a miss returns the key; and the official binding supersedes the
compile-time catalogs and **restores them** when disposed.

`packages/i18n/src/plugin.test.ts` — rewritten (+2 cases). The host-fallback
cases now install a stand-in host catalog instead of asserting on real product
copy, which is both what the mechanism actually does and one less test coupled
to a string somebody may reword. New: the overlay still resolves with NO host
source in the realm; and the explicitly-`undefined` param case that pins
Amiba's interpolation against upstream's.

Three test setups now install the catalogs (`packages/ui`,
`dsh-plugin-agent-preset`, `dsh-plugin-model-plane`) — a test realm has no
shell, so it plays the runtime-less part, through the same `@amiba/ui/locales`
entry Quick-Ask uses. Only those three needed it; the others' suites either
mock `@amiba/i18n` or render no host copy.

### 5.2 Acceptance criteria

| # | criterion | status |
| --- | --- | --- |
| 1 | switching language retitles everything at once, including other bundles' copy | **held by construction and guarded, not live-smoked.** The language path is untouched from `fd3c1fd` (realm official-source registry, cross-bundle test still green). What changed is where the strings come from, and every copy now reads ONE realm resolver, so a switch cannot reach some bundles and not others — it is strictly less bundle-dependent than before. No live pass; the brief rules it out here. |
| 2 | Quick-Ask and the notifier still localise with no DSH graph | **held.** §3: both entries install the merged catalogs, both built HTML entries preload the chunk carrying the copy, verify pins both calls, and the mechanism is the one the 9 registry tests exercise. Not live-tested (Electron-only). |
| 3 | zero keys lost among survivors | **verified, output in §6.** |
| 4 | `verify-pluginization --strict-i18n` green; both-language parity compile-enforced | **green** (345 files). Parity is now enforced three times: each owner's `Record<OwnKey, string>`, the merged table's annotation, and upstream's typed `register`. |
| 5 | plugin bundles no longer contain the UI dictionary | **met and measured**, §4. |

---

## 6. Zero-key-loss, actually run

The previous agent's cross-reference, re-run at HEAD (script unchanged: collect
`defined` from every dictionary file, scan every `.ts`/`.tsx` for `t("…")`,
report the difference):

```
dictionary files scanned: 15
distinct keys defined  : 722      (498 host + 224 plugin-overlay)
t("…") call sites      : 890
keys referenced but NOT defined: 5
  MISSING …                            <- doc-comment prose in 4 files (t("…") inside a comment)
  MISSING your.key                     <- packages/ui/src/locales/en.ts   (the how-to comment)
  MISSING options.example.greeting     <- packages/i18n/src/plugin.test.ts (fixture)
  MISSING options.example.doesNotExist <- packages/i18n/src/plugin.test.ts (fixture)
  MISSING options.example.title        <- packages/ui/src/test/i18n-message-registry.test.tsx (fixture)
```

All five are non-real: three deliberate test fixtures and two doc-comment
examples. **0 genuine misses.** 977 - 255 = 722 defined keys, exactly as
expected.

That check is now **repo tooling rather than analysis**: it runs inside
`verify-dsh-architecture.mjs` with comment stripping and test files excluded,
which removes all five non-real hits, and it reports **869 production call
sites against 722 keys, 0 undefined**. It also fails if the discovery patterns
drift (fewer than 3 dictionary files, 400 keys, or 700 call sites), so it
cannot start passing by finding nothing to check. Mutation M12 confirms it
fires on a real missing key.

---

## 7. Verify assertions added

All in `scripts/verify-dsh-architecture.mjs`, one new section (+344 lines):

- **the mechanism package ships no dictionary** — `en.ts`/`zh-CN.ts` must not
  exist; neither `index.ts` nor `plugin.ts` may import a catalog;
- **the realm slot** — realm symbol, supersede/restore, the out-of-order
  dispose guard, the epoch bump, and the fail-loud miss;
- **the epoch reaches React** — `index.ts` folds it into the store snapshot and
  joins the observer list; `usePluginT` takes its own store of it;
- **entry-point separation** — `@amiba/ui` exposes `./locales`; nothing under
  `packages/ui/src` outside that folder may reach it except by `import type`.
  The scan finds the *specifier* and reconstructs the statement backwards, so a
  value import that is not alone on its line is still caught (it was not, until
  mutation M3 exposed the gap);
- **one namespace, one registration site** — the constant, the typed
  `register`, the string-typed `bind`, the `LocaleNamespaceMap` merge, and a
  repo-wide sweep that fails on any `locale.register(` outside the one file;
- **the shell's two installs** — the unconditional catalog, and the
  registration on a `locale`-only fiber;
- **the runtime-less window exception** — the merge and both
  `installWindowMessages()` calls;
- **bundle purity on built output** — §4;
- **zero key loss** — §6.

---

## 8. Mutation checks — every assertion added

**Verify assertions: 16 mutations, 16 as expected** (15 caught + 1 negative
control correctly not caught). Each mutation was applied to the tree, verify
re-run, and the tree restored.

| # | mutation | outcome |
| --- | --- | --- |
| M1 | `packages/i18n/src/en.ts` re-created | caught |
| M2 | barrel does `export * from "./locales"` | caught |
| M3 | the type-only key import becomes a value import (`import { en } … ; void en;`) | caught **after a fix** — the first version of the scan required the import to be the whole line and missed it |
| M4 | the message registry stops bumping its epoch | caught |
| M5 | the out-of-order dispose guard is removed | caught |
| M6 | a second locale namespace is registered | caught |
| M7 | the shell drops the unconditional catalog install | caught |
| M8 | the registration is folded into the settingsScope fiber | caught |
| M9 | the purity probe string is reworded in the catalog | caught |
| M10 | `usePluginT` stops observing the registry | caught |
| M11 | `index.ts` stops joining the registry observers | caught |
| M12 | a call site names a key no dictionary defines | caught |
| M13 | Quick-Ask stops installing its catalog | caught |
| M14 | the window catalog stops merging the UI copy | caught |
| M15 | a miss returns `""` instead of the key | caught |
| M16 | *(negative control)* a comment naming every pinned identifier | correctly not caught |

**Built-artifact mutations: 3, all as expected.**

| # | mutation | outcome |
| --- | --- | --- |
| MB1 | a plugin value-imports `@amiba/ui/locales`; `dsh-plugin-runtime-inventory` rebuilt | caught, naming the bundle and the sentinel |
| MB2 | the sentinel is removed from the ui-shell's built bundle (the positive control's failure mode) | caught |
| MB3 | no built bundle present at all | printed the SKIP, did not pass silently |

**Test assertions: 10 mutations, 10 caught.**

| # | mutation | suite outcome |
| --- | --- | --- |
| T1 | epoch dropped from the `useT` store snapshot | 2 failed |
| T2 | `index.ts` stops observing message installs | 2 failed |
| T3 | `usePluginT` stops observing message installs | 1 failed |
| T4 | `installMessages` disposes to nothing instead of restoring | 1 failed |
| T5 | out-of-order dispose clobbers the current source | 1 failed |
| T6 | a miss returns the empty string | 4 failed |
| T7 | the host fallback ignores the asking copy's language | 2 failed |
| T8 | the official locale ids are swapped in `toOfficialCatalog` | 3 failed |
| T9 | the shell registers but never installs the bound translate | 2 failed |
| T10 | the merged dictionary drops the shell's own copy | 2 failed |

---

## 9. What I refused to fake

- **No live smoke.** The brief rules it out for this worktree and the known
  `dsh-llm` rc.8 / `dsh-attachment` rc.6 peer drift still blocks
  `runtime:prepare`. Acceptance 1 and 2 are reported as "held by construction
  and guarded", never as "verified live".
- **`apps/desktop`'s 9 keys are not in the central registration**, and I said
  so in §2.1 rather than quietly satisfying the sentence "each owner's
  dictionary" by inverting the plugin/app dependency direction.
- **`usePluginT` still resolves its LANGUAGE from the document attribute.** I
  moved only its dictionary lookup onto the realm. The previous agent's reason
  for not moving the language half (callers read the DOM synchronously during
  render while the mirror advances on a microtask) is unchanged and I did not
  paper over it — see the concern in §10.
- **No hand-written restatement of upstream's `register`/`bind` signatures.**
  The first draft of `messages.ts` declared its own `AmibaLocaleRegistrar`
  interface with a hand-typed `register`; I replaced it with
  `Pick<LocaleRuntime, "register" | "bind">` off upstream's own exported class,
  so drift is a compile error rather than a comment.
- **No cast in the locale-id re-keying.** `toOfficialCatalog` derives the
  pairing through `fromOfficialLocaleId` instead of asserting
  `{} as Record<OfficialLocaleId, T>`.
- **The plugin-owned host keys were not migrated into plugin overlays.** That
  is the T11 plugin-local-dict work; doing it here would have moved 26 more
  keys under cover of a different change and bought nothing for any acceptance
  criterion.

---

## 10. Concerns

1. **A composition without `@deepseek-ai/dsh-client-locale` now renders from
   the shell's compile-time catalogs, not from the official service.** That is
   the safe direction, but it means the official registration is only *read*
   when the service exists. If someone later removes the unconditional install
   thinking it redundant, a locale-less graph goes to raw keys for the whole
   product. verify pins it (M7) and the pin's message says why.
2. **`usePluginT`'s two halves can disagree for one observer tick.** Its
   language comes from `<html lang>` (synchronous), its host templates from the
   official runtime's own active locale. Between an official switch and the
   attribute projection landing, a plugin's overlay string could render in the
   old language beside a host string in the new one. Both settle on the next
   microtask. Fixing it properly means the lazily-reconciling snapshot the
   previous agent declined to write.
3. **`MessageKey` is now `never` in a program that can see no owner.** That is
   deliberately loud, but it makes the augmentation imports in
   `packages/ui/src/index.ts` and `src/plugin.ts` load-bearing in a way a
   reviewer might mistake for dead code — both carry a comment saying so, and
   `plugin.ts` needed one only because `ModelSummary`/`ModelPickerDialog`/
   `ModelInfoCard` call `useT()` and ship through that entry.
4. **Two realm slots now, and the second has the opposite global/not-global
   boundary from the first.** The reasoning is written out in both files, but
   "realm-wide observers are fine here and a bug there" is a genuinely
   non-obvious pair of rules to hold in one package.
5. **The registration fiber and the authority fiber can now resolve at
   different times.** Registration needs only `locale`; the authority also
   needs `settingsScope`, `connection`, `remote`. A composition with `locale`
   but not `settingsScope` gets Amiba's copy in the browser-derived language
   and no migration — which is the correct behaviour, but it is a state that
   did not exist before.
6. **`sidepanel.approvalMode.*` was in the deleted 247** while approval mode is
   a live feature. The previous report flagged it as looking like a rename that
   orphaned keys; the user's decision was to delete all 247, so they went. If
   approval-mode copy turns out to be missing somewhere, that family is where
   to look first — the live approval keys are `sidepanel.permission.*` and
   `sidepanel.permissionPreset.*`, which survive.
7. **The three plugin/ui test setups that install catalogs are a new coupling.**
   A suite that starts asserting on host copy without installing them will read
   raw keys — loudly, but the fix is not obvious from the failure. Left as
   three local installs rather than a shared helper because only three needed
   it.
