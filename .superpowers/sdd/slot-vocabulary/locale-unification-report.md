# One 语言 row: the official locale service becomes Amiba's language authority

Branch `worktree-agent-a2c0443b7b0611d80`, base `main @ e67d13a`. Two commits,
none pushed, none merged.

| commit | scope |
| --- | --- |
| `5d93a2d` | `feat(locale)` — the authority, the mapping, the migration, the retired row |
| (below) | `docs(slots)` — verify assertions, three docs, this report |

**Status: all three tasks landed.** Nothing was faked; one thing I declined to
invent is recorded in §7.

---

## 1. What the official service actually is

Read from the staged bundle, not from the brief
(`packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-client-locale/`):

| fact | evidence |
| --- | --- |
| ids are `zh` and `en`, nothing else | `lib/types/locale-settings.d.ts:8` (`LOCALE_IDS`), `lib/client.js:985-991` (`LOCALES`) |
| `setLocale` THROWS on an unregistered id | `lib/client.js:1066-1067` — `locale "${id}" is not registered` |
| the LocaleFace pair is `getSnapshot()` / `subscribe(fn)` | `lib/types/client/index.d.ts:96-110` |
| the durable selection is one optional field | `locale-settings.d.ts:12-15` — `LocaleSettings { preference?: LocaleId }`, "explicit locale selection; absence delegates to the browser" |
| `setLocale` is that field's ONLY writer | `lib/client.js:1070` — `this.host?.set(LOCALE_PREFERENCE_FIELD, match.id)` |
| absence means "browser-derived" | `lib/client.js:1077-1083` — `adopt`: `section.preference ?? this.provisional` |
| the section lives in the `locale` settings namespace | `locale-settings.d.ts:4`, bound at `lib/client.js:1184` |
| the runtime is published at `ctx.locale` | `lib/client.js:1193` — `ctx.provide("locale", locale)` |
| its row is `settings.general.item` `id: "language"`, `order: 0` | `lib/client.js:1211-1218` |

The row is live in Amiba: `bundles/dsh-bundle-amiba-web/cordis.patch.yml` keeps
the `locale` client row ENABLED, and since the settings-dialog phase Amiba's own
root declares `settings.general.item`. That is exactly why the product grew a
second 语言 row — the bundle patch's comment still claimed the registration
"renders nothing here", which stopped being true one phase ago and is corrected
in this change.

---

## 2. Task 1 — `@amiba/i18n` follows the official locale

`packages/i18n/src/index.ts` is now organised around one question, and
`hasOfficialLocale()` is the answer a caller reads:

1. **A DSH client runtime is present.** Whoever owns the plugin context calls
   `installOfficialLocale(source)` with the official `LocaleRuntime`. That
   source is authoritative: `useT` is a `useSyncExternalStore` over it, so an
   official switch re-renders Amiba's copy in the same tick with no reload.
2. **No plugin runtime.** Nothing is installed; the language resolves
   `readDocumentLanguage() ?? detectBrowserLanguage()` — the existing
   `navigator.language` chain, unchanged in behaviour.

### The detection, and why it is not a global probe

The brief said not to assume a global is always present, and there is no global
here at all. `installOfficialLocale` is an explicit hand-off from the one place
that legitimately holds a `ctx`: `dsh-plugin-ui-shell`'s `apply`. Nothing
sniffs `window.__ModuleLoader__` or a DOM marker; a surface either was given the
service or it was not, and `hasOfficialLocale()` reports which.

### Why `document.documentElement.lang` is still load-bearing

This is the half the brief did not ask about and that the design would have been
wrong without. **Every plugin bundle is built separately and carries its own
copy of `@amiba/i18n`'s module state.** `installOfficialLocale` in the ui-shell
bundle reaches `@amiba/ui` components inside that bundle and nothing else —
and `@amiba/ui` is bundled into eight other plugins
(`model-plane`, `skills`, `catalog`, `mcp-manager`, `messaging-core`,
`schedule-adapter`, `usage`, `agent-preset`), each of which renders `useT`-using
components in its settings page.

So the document `lang` attribute keeps its existing role as the cross-realm
projection, with the roles now stated explicitly: **the realm holding the
official source PUBLISHES it; every other realm OBSERVES it** (this module's
own `MutationObserver`, `./plugin.ts`'s `usePluginT`, and the
`settings.section` ledger's language cache key in the ui-shell). A switch in the
official row therefore reaches every plugin page, not just the shell's.

`@amiba/i18n` deliberately does **not** depend on `@deepseek-ai/*` — Quick-Ask,
the notifier and the browser surfaces consume it without a DSH graph — so
`OfficialLocaleSource` is structural (`{ getSnapshot(): { active: string };
subscribe(fn): () => void }`), matching the LocaleFace the framework itself
consumes through `ctx.slots.installLocale`.

### The id mapping

| direction | function | property |
| --- | --- | --- |
| Amiba → official | `toOfficialLocaleId(language): OfficialLocaleId` | the RETURN TYPE is the official union, so `zh-CN` reaching `setLocale` is a compile error, not a runtime throw |
| official → Amiba | `fromOfficialLocaleId(id: string): ResolvedLanguage` | TOTAL: one `return`, no throw, primary-subtag match (`zh-Hans-CN` → `zh-CN`, everything else → `en`) — the same derivation upstream's own `detectBrowserLocale` performs |

`OfficialLocaleId = "zh" | "en"` is written out in `@amiba/i18n` because that
package cannot import the official one. The tie is a compile-time probe in the
package that CAN:
`plugins/dsh-plugin-ui-shell/src/client/locale-bridge.ts` →
`OfficialLocaleIdMatchesUpstream`, a `Mutual<>` table against upstream's
`LocaleId`. Verified to bite: widening the union to include `zh-CN` produces
`error TS2344: Type '{ ids: false; preference: true; }'` (mutation M2).

### The no-runtime seed

`<html lang="en">` is a static literal in all three renderer HTML files, so a
document-lang read alone would have pinned Quick-Ask and the notifier to English
regardless of the machine's language — a real regression against today. Those
two entries (and the main renderer, and ui-shell's `apply`) now call
`seedDocumentLanguage()`, which publishes `detectBrowserLanguage()` into the
contract and is a no-op once an official source exists. Side benefit: those two
windows carry a truthful `lang` attribute for the first time.

---

## 3. Task 2 — the retired control, and what went with it

`SettingsPreferences.tsx`: the language `SegmentedRow`, `langPref`,
`languageOptions`, `onLangChange` and the `AppearanceSection` props that carried
them are gone. The `settings.general.item` seat is untouched — it is still the
last child of the page's row stack, which is where the official `LanguageRow`
lands.

**Removed** (no writer left anywhere in the product):

| symbol | why it is dead |
| --- | --- |
| `useStoredLanguagePreference` | the only caller was the retired row |
| `saveLanguagePreference` | the hook's `update` was the only writer |
| `resolveLanguage(pref)` | its two callers seeded the document from the stored preference; both now seed from the browser and the official service replaces it |
| `useT().preference` | nothing destructured it (checked repo-wide) |
| the storage-bootstrapped language mirror (`bootstrapLanguageMirror`) | it existed to mirror `storage.watch` into the non-React subscription; there is no preference to watch |
| `options.preference.language{,.auto,.en,.zh-CN}` in both catalogs | the row's copy. Key parity is compile-enforced (`zhCN: Messages`), so removing from both stays green |

**Kept, deliberately:**

| symbol | why |
| --- | --- |
| `LANG_PREF_STORAGE_KEY`, `LanguagePreference`, `DEFAULT_LANGUAGE_PREFERENCE`, `loadLanguagePreference` | the migration's single remaining read. `LanguagePreference` still carries `auto` because that is a value already on disk |
| `markLanguagePreferenceMigrated` (replaces `saveLanguagePreference`) | writes `auto` — see §4 |
| `detectBrowserLanguage`, `readDocumentLanguage` | THE no-runtime fallback. Pinned by verify so a later cleanup cannot quietly drop it |
| `getCurrentLanguage` / `subscribeLanguage` | the non-React handle. No in-repo consumer today, but they are now trivial reads of the new mirror rather than storage plumbing, so keeping them costs nothing and they are the only language API a non-React caller has. Reported rather than deleted silently |
| `useT`, both dictionaries | explicitly out of scope |

---

## 4. Task 3 — the migration

`migrateLegacyLanguagePreference` in `locale-bridge.ts`, wired from `apply`
through `ctx.inject(["locale", "settingsScope", "connection", "remote"], …)`.

```
preference = await loadLanguagePreference()
  "auto"  -> return                     (already the official never-chosen state)
  else    -> target = toOfficialLocaleId(preference)
             subscribe to the official locale settings scope, then:
               status !== "ready"            -> wait (NOT "never chosen")
               !writable                     -> retire, write nothing
               value.preference !== undefined-> retire, official wins
               otherwise                     -> retire, setLocale(target),
                                                mark migrated
```

### How "never chosen" is determined — and yes, it is distinguishable

**Not** from the active locale. While nothing is chosen, `active` already equals
the browser-derived provisional value, so "active is `en`" and "the user picked
`en`" are the same observation. The active locale cannot answer this.

From the durable section, which is explicit. `preference` is documented as
"explicit locale selection; absence delegates to the browser"; `setLocale` is
its only writer; upstream's own `adopt` reads `section.preference ?? provisional`.
So **an absent `preference` on a `ready` snapshot is precisely "the official
service has nothing to say"** — the same state Amiba's retired `auto` meant.

The brief asked what to do if "never chosen" could not be told apart from "chose
the fallback". It can: the field's domain is `"zh" | "en"` and there is no
`"auto"`/fallback member to confuse with absence. `FALLBACK_LOCALE = "zh"` is a
lookup fallback inside the dictionary chain, never a value written to the
section.

One judgement call remains and I took the conservative side. `SettingsScope`
exposes both the resolved `value` and the raw `user` layer, and its docs say a
field's PRESENCE in `user` is what marks it overridden. So a deployment could in
principle pin `preference` through a composition layer with no user having
chosen anything. **I test the resolved `value`, not `user`** — if a base layer
names a locale, the official service already has an answer and Amiba's retired
setting must not out-vote the deployment's configuration. That is also exactly
the condition under which `adopt` stops falling back to the browser. The
trade-off: a user who chose English in Amiba, on a deployment whose base layer
pins `zh`, lands on Chinese and has to pick English once in the official row.
I judged "never silently override the deployment" the safer failure.

### Why `!writable` blocks the migration

In memory mode (`mode: "memory"`, `writable: false` — a remote browser, or a
namespace not exposed to this client) `setLocale` would flip the display but
`host.set` could not persist. Marking the migration done there would move the
user once and lose the choice at the next launch. Nothing is written and nothing
is marked, so a later writable session still migrates.

### The marker

There is no second key. The migration stamps `settings.ui.language` back to
`"auto"`, which is simultaneously the truthful post-migration state (Amiba no
longer owns a preference) and the "already migrated" signal — a later launch
reads `auto`, finds nothing to carry, and leaves the official selection alone.
So a user who migrates to English and then switches to 中文 in the official row
stays on 中文 across restarts (acceptance 3, pinned by the "leaves an existing
official selection alone" and "only ever migrates once" cases).

### Why `ctx.inject` rather than the plugin's `inject` list

`export const inject = ["slots", "sessions"]` is unchanged. Adding `locale` /
`settingsScope` there would gate the whole product shell on services that may
not be provided; with `ctx.inject` the root registers unconditionally and a
composition without a locale service simply keeps the browser-derived fallback —
the same code path Quick-Ask runs. This is the pattern the file already uses for
`inputTriggers`. `connection` and `remote` are injected because
`settingsScope.bind` binds the namespace to the settings transport and the
forwarded invalidation on the CALLER's fiber.

### One namespace string, tied to upstream

`ctx.settingsScope.bind({ namespace: "locale" })` needs the official namespace.
Importing it as a VALUE from `@deepseek-ai/dsh-client-locale` would cross the
client-bundle purity gate (the settings-scope docs are explicit that cross-plugin
collaboration runs through cordis services, not value imports). So the literal is
restated — and annotated with upstream's own const type:

```ts
import type { LOCALE_SETTINGS_NAMESPACE as UpstreamLocaleNamespace } from "@deepseek-ai/dsh-client-locale";
const LOCALE_SETTINGS_NAMESPACE: typeof UpstreamLocaleNamespace = "locale";
```

A rename upstream is a compile error here (mutation M17). The preference FIELD
needs no such treatment: the bridge reads `snapshot.value?.preference` through
the official `LocaleSettings` type, so there is no string at all.

`@deepseek-ai/dsh-client-locale@0.1.0-rc.6` was added as a ui-shell
**devDependency**; every import from it is `import type`, so nothing survives the
build.

---

## 5. Tests

`pnpm -r test`: **623 passed, 0 failed** (was 603 on `main`; +20).

| suite | cases | what it holds |
| --- | --- | --- |
| `packages/ui/src/test/i18n-official-locale.test.tsx` (renamed from `i18n-language-stability`) | 9 | the mapping never yields an unregistered id; totality both ways incl. `zh-Hans-CN` / `en-GB` / an id Amiba has never seen; round-trip; official switch re-renders the mounted tree AND swaps the catalog with no reload; the document contract is published on install and on switch; official outranks the document; the navigator fallback; seeding over `lang="en"`; a non-publishing realm following the document contract |
| `plugins/dsh-plugin-ui-shell/src/client/locale-bridge.test.ts` | 11 | the namespace is upstream's; the authority adopts and re-publishes; and eight migration cases — `loading` is not never-chosen, the carry-over + marker + retirement, `zh-CN` → `zh` and never `zh-CN`, `auto` no-ops, an existing official selection is left alone, a non-writable section is not migrated into, republishes cannot re-run it, dispose stops it, a failed preference read is reported not thrown |
| `packages/ui/.../settings-seats.test.tsx` | +1 (and 1 amended) | the page draws NO language row of its own; the `settings.general.item` placement case now anchors on the Theme row |

The `settings-seats` amendment is worth naming: that case asserted the seat sits
in "the same stack as the language/theme rows" and it FAILED after the row was
removed, which is the test doing its job.

---

## 6. Mutation checks

Every assertion added was broken, the gate re-run, and restored. **24
mutations, all 24 caught; plus 1 negative control that correctly did not fire.**
Harness: `scratchpad/mutate.mjs` (out of repo), gates
`verify-dsh-architecture` / `tsc` / `packages/ui` vitest /
`dsh-plugin-ui-shell` vitest.

| # | mutation | gates | result |
| --- | --- | --- | --- |
| M1 | `toOfficialLocaleId` return type widened to `string` | verify | caught |
| M2 | `OfficialLocaleId` widened to include `zh-CN` | verify, tsc | caught (tsc: `ids: false` on the upstream probe) |
| M3 | `fromOfficialLocaleId` made partial (throws) | verify | caught |
| M4 | `navigator.languages` dropped from `detectBrowserLanguage` | verify | caught |
| M5 | the no-runtime fallback chain replaced by a constant | verify, ui | caught |
| M6 | `installOfficialLocale` stops subscribing | verify, ui | caught |
| M7 | migration hands `setLocale` Amiba's tag instead of the mapping | verify, shell | caught |
| M8 | `setLocale(preference)` instead of the derived id | verify, shell | caught |
| M9 | the `loading` guard dropped | verify, shell | caught |
| M10 | the `!writable` guard dropped | verify, shell | caught |
| M11 | the durable-selection test inverted | verify, shell | caught |
| M12 | the `auto` early return dropped | verify, shell | caught |
| M13 | a private `amiba.locale` namespace | verify, shell | caught |
| M14 | `setLocale("zh-CN")` spelled at a call site | verify | caught |
| M15 | Amiba's own 语言 row reintroduced | verify, ui | caught |
| M16 | `useStoredLanguagePreference` brought back | verify | caught |
| M17 | the upstream namespace const renamed under the annotation | tsc | caught |
| M19 | install stops publishing the document contract | ui | caught |
| M20 | `seedDocumentLanguage` made a no-op | ui | caught |
| M21 | official no longer outranks the document contract | ui | caught |
| M22 | the migration never retires (re-runs; dispose is a no-op) | shell | caught |
| M24 | a failed preference read swallowed instead of reported | shell | caught |
| M25 | `toOfficialLocaleId` leaks `zh-CN` through a cast | ui | caught |
| M26 | `fromOfficialLocaleId` collapses every id onto `zh-CN` | verify, ui | caught |
| M23 | *(negative control)* prose-only edit in the bridge doc block | verify | correctly not caught |

Two of these are the checks that actually matter for the brief's acceptance
criteria and neither was free:

- **M14** is caught by a repo-wide scan, not by a pattern in one file: verify
  walks every source file under `packages/`, `plugins/` and `apps/` (tests
  included) and fails on any `setLocale("<literal>")` whose literal is not `zh`
  or `en`. A test asserting `setLocale("zh-CN")` would be asserting the throw
  path as if it were normal.
- **M4 / M5** are the "no-runtime fallback still exists" pin, split in two: the
  navigator derivation itself, and the resolution chain that reaches for it.

The negative control (M23) is recorded because the bridge's doc block quotes its
own vocabulary; verify's `code()` comment stripper is what keeps prose from
satisfying a pin, and M23 confirms the stripper is applied to this file.

---

## 7. Gates

| gate | result |
| --- | --- |
| `pnpm -r build` | pass |
| `pnpm -r typecheck` | pass |
| `pnpm -r test` | **623 passed, 0 failed** |
| `node scripts/verify-dsh-architecture.mjs` | pass |
| `node scripts/verify-pluginization.mjs --strict-i18n` | pass (336 files) |
| `pnpm install --frozen-lockfile` | pass |

Cold-worktree bootstrap order that actually worked (the brief's order does not,
and neither does the one in the settings-dialog report): `pnpm install` first
(it fails `apps/cli prepare` — expected, `@amiba/app-runtime/dsh-runtime` has no
`dist` yet — but populates `node_modules`), then `pnpm -r build`, and only then
`pnpm --dir packages/app-runtime build:dsh-runtime`. Run before the workspace
build, `build:dsh-runtime` fails with `tsc: command not found` and then, once
`tsc` exists but `@amiba/extension-sdk` has no `dist`, with four TS2345s about
`settings.section` "not assignable to `root`" — the SlotMap augmentation simply
has not been emitted yet.

## 8. What I refused to fake

- **No live smoke.** `pnpm --dir packages/app-runtime runtime:prepare` cannot
  complete in this worktree, so there is no staged runtime to launch. The
  staging `npm install` dies with `ERESOLVE`: the manifest pins the DSH stack at
  `0.1.0-rc.6`, npm resolves `@deepseek-ai/dsh-llm` to the newer `0.1.0-rc.8`,
  and that build peer-requires `@deepseek-ai/dsh-attachment@^0.1.0-rc.8` against
  the pinned `dsh-attachment@0.1.0-rc.6`
  (log: `packages/app-runtime/.cache/dsh-runtime/npm/_logs/*-eresolve-report.txt`).
  That is upstream registry drift, not something this change touches — it
  reproduces on the unmodified tree, before any edit of mine, and it is worth
  someone's attention on its own. It does mean everything here is unit-level and
  gate-level; I did not claim a run I did not do. See §9.1. (The official locale
  sources quoted throughout §1 were read from the already-staged runtime in the
  main checkout, which predates the drift.)
- **`@amiba/i18n` did not grow a `@deepseek-ai/*` dependency** to make the id
  union "official". Quick-Ask and the browser surfaces consume that package with
  no DSH graph; the union is restated and tied by a probe in the package that
  already carries the dependency, which is the same shape the extension-SDK uses
  for the settings owner contracts.
- **The namespace string is restated, not value-imported.** A value import from
  `@deepseek-ai/dsh-client-locale` into a client bundle is what the settings-scope
  contract explicitly directs away from. It carries upstream's const type so the
  restatement cannot drift.
- **`user`-layer override detection was not used** to widen the migration's
  reach. §4.
- **Quick-Ask was not taught to read the official preference over the settings
  RPC.** It has a `DshApiClient` and `settings.describe` exists, so it is
  technically reachable — but that would be a THIRD path to the same fact, in a
  window the brief explicitly scoped to the navigator fallback. Recorded as a
  known gap instead: see §9.2.

## 9. Concerns

1. **Not live-smoked** (§8). Three things specifically want a real run: (a) the
   official `LanguageRow` is styled from `--dsw-*` tokens, which only
   `dsh-client-ui-theme` defines — and Amiba deliberately keeps that row out.
   The row ships its own CSS module (`lib/client.js:879`) referencing
   `--dsw-alias-border-l2`, `--dsw-alias-bg-module-platform`,
   `--dsw-alias-label-primary`, `--dsw-alias-interactive-bg-hover`; with no
   theme row those variables are undefined and the row may render unstyled or
   invisible inside Amiba's Appearance page. **This is the single biggest
   unverified risk in the change** and it is a pre-existing property of the
   seat, not something this change introduced — but this change makes that row
   the ONLY way to switch language, which raises the stakes from "an odd extra
   row" to "the control might be unusable". It wants eyes before merge.
   (b) The migration's first-launch timing against a real Host settings
   document. (c) `ctx.inject(["locale", …])` resolving in the real boot order.
2. **Quick-Ask and the notifier do not follow an official choice.** They have no
   plugin graph, so a user who picks English in the main window still gets the
   machine language in the popup. That is the brief's stated design, and it
   matches today's behaviour for `auto` users — but it is a real behavioural
   difference for the users this change migrates, who previously had those
   windows follow their explicit choice through the shared PlatformAdapter
   storage. Closing it means either an RPC read of the `locale` namespace at
   those entries or a platform-storage mirror written by the ui-shell realm;
   both are one file's worth of work, neither was in scope.
3. **The migration is best-effort at the write.** `setLocale` publishes
   synchronously and `host.set` is a queued async write; the marker is stamped
   after `setLocale` returns, not after the write settles. A write that is
   accepted by the queue and then rejected by the Host would leave the marker
   burned and the choice lost. Waiting on the settlement is not possible through
   `setLocale`'s `void` return, and reaching around it into the scope to write
   `preference` directly would be Amiba writing another plugin's namespace. The
   `!writable` guard removes the predictable version of this failure; the
   racy one remains.
4. **`getCurrentLanguage` / `subscribeLanguage` have no in-repo consumer.** They
   survive as the non-React language handle (their doc block still refers to a
   `host.i18n` wiring that no longer exists in this repo). Cheap to keep, and
   deleting a public-ish API of a shared package on a hunch felt worse than
   reporting it — but if nothing outside the repo uses them they should go.
5. **The seat's position puts 语言 at the BOTTOM of the Appearance page**, below
   Theme, Accent and message width, because `settings.general.item` is the last
   child of the row stack and that placement is pinned by the previous phase's
   test. Amiba's own row used to be first. Nobody asked for a position, and
   moving the seat would break an existing pin, so it stayed — but the most
   frequently-changed preference on that page is now the last one on it.
6. **`useT()` no longer returns `preference`.** No in-repo caller destructured
   it, but it is a shape change on a shared package's most-used hook.
7. **The document-lang contract is now the ONLY channel to the other eight
   plugin bundles.** It was already load-bearing (the ledger's cache key,
   `usePluginT`), but before this change those bundles ALSO had the
   `storage.watch` broadcast as a second path. Losing the redundancy means an
   accidental `document.documentElement.lang` write by any code in the window
   would desync every non-shell realm for one observer tick — the shell's
   own observer heals it, since it republishes the official value, but the
   ordering is not something a test pins.
