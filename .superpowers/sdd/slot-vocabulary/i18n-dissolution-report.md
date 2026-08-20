# Dissolving `@amiba/i18n`: the mechanism landed, the dictionary split did not

Branch `worktree-agent-adaeaf38e8eeb9862`, base `main @ 8b123e5`. Nothing
pushed, nothing merged.

| commit | scope |
| --- | --- |
| `fd3c1fd` | `feat(locale)` — the realm-wide official-source registry (commit 1) |
| (this file) | `docs(locale)` — the report, the key census, the commit-2 findings |

**Status: commit 1 landed and is green on every gate. Commit 2 was deliberately
NOT attempted** — the brief's own stop condition fired, and §5 is the evidence
plus the decision-ready owner table. Nothing was faked; §9 lists what I declined
to invent.

---

## 1. Commit 1 — what actually changed

`packages/i18n/src/index.ts` held the official `LocaleRuntime` in a
module-level `let officialSource`. Every DSH client plugin bundle inlines its
own copy of that module, and exactly one of them (ui-shell's) has an `apply`
holding a `ctx`. So exactly one copy ever had a source; the other nine resolved
`readDocumentLanguage() ?? detectBrowserLanguage()` forever, and the only thing
carrying an official switch to them was `document.documentElement.lang` — a
MutationObserver hop, i.e. cross-bundle synchronisation happening by accident
through the DOM.

The source now lives on the realm-wide symbol registry under
`Symbol.for("@amiba/i18n/official-locale")`, following the two precedents named
in the brief: `Symbol.for("@amiba/app-runtime/platform-adapter")`
(`packages/app-runtime/src/platform/index.ts:725`) and
`Symbol.for("@amiba/ui/settings-page-chrome")`
(`packages/ui/src/settings/page-chrome.tsx:37`).

**`useT()` call sites did not change.** Not one `useT`/`usePluginT` call site
moved; `installOfficialLocale`, `hasOfficialLocale`,
`seedDocumentLanguage`, `getCurrentLanguage` and `subscribeLanguage` all kept
their signatures.

### 1.1 The exact global / not-global boundary

```ts
interface OfficialLocaleRegistry {
  source: OfficialLocaleSource | null;   // GLOBAL — realm-singular
  unsubscribe: (() => void) | null;      // GLOBAL — the ONE subscription
  readonly observers: Set<() => void>;   // GLOBAL — install-notification list
}
```

| name | scope | why |
| --- | --- | --- |
| `source` | **realm** | there is exactly one official `LocaleRuntime` per renderer. Every copy must resolve the same instance or they disagree about the active language. |
| `unsubscribe` | **realm** | the registry takes ONE subscription on the official runtime and fans out. N bundle copies must not mean N listeners on upstream's `LocaleFace`. |
| `observers` | **realm** | see §1.2. |
| `cachedLanguage` | **module (per copy)** | each copy's `useSyncExternalStore` snapshot. |
| `languageSubscribers` | **module (per copy)** | non-React observers registered against *that* copy. |
| `storeSubscribers` | **module (per copy)** | the `useSyncExternalStore` listener list belonging to *that copy's* React trees. |

The three per-copy names are the part that breaks quietly if rushed. Hoisting
them would collapse N independent stores into whichever copy's list was created
first: every copy's `refreshLanguage` would then walk the *same* list, and a
single official switch would notify each listener once per copy. That is not
theoretical — it is exactly what mutation M3/M5 produce, and the guard observes
it as `['zh-CN', 'zh-CN']` where `['zh-CN']` was expected (§7).

### 1.2 How install-notification works

A slot alone is not enough. A copy that finished loading *before*
`installOfficialLocale` ran has already computed `cachedLanguage` from the
no-runtime chain; writing the source into a registry field would leave that copy
stuck on the stale value with nothing to tell it otherwise.

So the registry carries a list, and the protocol is three lines:

1. **At module load**, every copy joins:
   `officialLocaleRegistry().observers.add(refreshLanguage);`
   (A copy loading *after* an install needs nothing extra — its
   `let cachedLanguage = resolveActiveLanguage()` initialiser already reads the
   registry's `source`.)
2. **On install**, the installing copy sets `source`, takes the one
   subscription with `notifyRealm` as the callback, and calls `notifyRealm()`
   once immediately. `notifyRealm` runs every registered `refreshLanguage`.
3. **On dispose**, the same fan-out runs after `source` is nulled, so every copy
   falls back together.

Each woken `refreshLanguage` then does its own work in its own module scope:
re-resolve, compare against *its* `cachedLanguage`, and notify *its* two
subscriber sets. The realm carries the fact; each copy carries the reaction.

### 1.3 What the document-language contract is still load-bearing for

It is **no longer the cross-bundle channel for `useT`.** It is still needed for:

1. **The genuinely runtime-less windows** — Quick-Ask
   (`apps/desktop/src/renderer/quick-ask/index.tsx:37`) and the notifier
   (`apps/desktop/src/renderer/notifier/index.tsx:16`). They boot no DSH plugin
   graph at all, so there is no official source in their realm to resolve.
   `seedDocumentLanguage()` publishes the browser-derived value at entry, and
   `readDocumentLanguage()` is the read side of that same fallback. Both are
   kept and both are still pinned by verify.
2. **`packages/i18n/src/plugin.ts`'s `usePluginT`**, which observes the
   attribute directly and was left untouched in commit 1 (see §9).
3. **Nine non-React slot-label readers in the plugins** —
   `plugins/dsh-plugin-skills/src/client/index.tsx:17`,
   `dsh-plugin-catalog/src/client/index.tsx:42`,
   `dsh-plugin-agent-preset/src/client/index.tsx:33`,
   `dsh-plugin-schedule-adapter/src/client/index.tsx:20`,
   `dsh-plugin-model-plane/src/client/index.tsx:154`,
   `dsh-plugin-memory/src/client/index.tsx:95`,
   `dsh-plugin-usage/src/client/TokensTab.tsx:123`,
   `dsh-plugin-runtime-inventory/src/client/index.tsx:94`,
   `dsh-plugin-messaging-core/src/client/index.tsx:104`. These are plain
   functions with no hook and no `ctx` in hand; the official answer for them is
   `locale: NS` on the slot registration, which is commit-2 work.
4. **The ui-shell `settings.section` ledger's cache key**
   (`plugins/dsh-plugin-ui-shell/src/client/index.tsx:219`), which invalidates
   its memoised section rows on a language change.
5. **`<html lang>` being correct in its own right** — `:lang()` selectors and
   assistive technology. This one is not a workaround; it is the attribute's
   actual job.

Because of 2–5, `refreshLanguage` still publishes the attribute whenever a
source exists. The change is that publication is now a *projection* of the
authoritative value rather than the *transport* for it.

---

## 2. Acceptance criteria, against commit 1 only

| # | criterion | status |
| --- | --- | --- |
| 1 | official switch retitles everything at once, including other bundles' copy | **improved and guarded** — now synchronous through the registry rather than deferred through a MutationObserver microtask. Guarded by `i18n-cross-bundle-locale.test.tsx`; not live-smoked (§9). |
| 2 | zero keys lost | **not applicable** — no key moved. The census that would prove it after a split is in §5.1 and it reports 0 missing keys today. |
| 3 | Quick-Ask / notifier localise with no DSH graph | **held** — the fallback chain and both entry-point `seedDocumentLanguage()` calls are unchanged and still pinned. |
| 4 | `verify-pluginization --strict-i18n` green | **green**, 337 files. Both-language parity is still compile-enforced by `zhCN: Messages`. |
| 5 | a non-UI-owning plugin bundle no longer carries the UI dictionary | **NOT met** — this was commit 2's whole point. §5.3 measures what it still costs and confirms the assertion is mechanically checkable in this worktree. |

---

## 3. Gates

| gate | result |
| --- | --- |
| `pnpm -r build` | pass |
| `pnpm -r typecheck` | pass |
| `pnpm -r test` | **629 passed, 0 failed** across 21 projects (was 623 at the end of the previous phase; +6 = the new cross-bundle file, 74 files in `packages/ui` up from 73) |
| `node scripts/verify-dsh-architecture.mjs` | pass |
| `node scripts/verify-pluginization.mjs --strict-i18n` | pass (337 files) |
| `pnpm install --frozen-lockfile` | pass |

Cold-worktree bootstrap that worked here — the brief's order does not, and this
matches the previous phase's report: `pnpm install` FIRST (it fails
`apps/cli prepare` with two TS2307s because `@amiba/app-runtime/dsh-runtime`
has no `dist` yet — expected, and `node_modules` is populated anyway), then
`pnpm -r build`. `build:dsh-runtime` was never needed for these gates.

---

## 4. Tests added

`packages/ui/src/test/i18n-cross-bundle-locale.test.tsx` — 6 cases. It
manufactures the second bundle copy for real with `vi.resetModules()` plus a
second dynamic import, the idiom
`packages/ui/src/settings/__tests__/page-chrome-cross-bundle.test.tsx` already
established (React stays shared because it is externalized).

**Every assertion is made synchronously, in the same task as the switch.** That
is the load-bearing detail: the document attribute is still published, so a test
that awaited a microtask would pass with or without the registry. jsdom delivers
MutationObserver records on a microtask, so same-tick delivery can only have
come through the registry fan-out.

| case | what it holds |
| --- | --- |
| wakes a copy that was already mounted | the install-notification list — copy B renders, *then* copy A installs, and copy B retitles in the same tick |
| re-renders a non-installing copy on a switch | the single fan-out subscription |
| reports the source from every copy, one subscription | `hasOfficialLocale()` is realm-wide; `subscriberCount() === 1` for two copies |
| restores the fallback in every copy on dispose | dispose fans out too; the upstream listener is released |
| one switch, one notification per copy | the not-global boundary for `languageSubscribers` |
| one copy's unsubscribe does not silence another | the same boundary, from the disposal side |

Two existing cases in `i18n-official-locale.test.tsx` were re-titled because
their old names asserted a claim that is no longer true ("the cross-realm
document contract every other bundle observes" → "keeps `<html lang>` truthful
for the surfaces that read it directly"; "follows the document contract
published by whoever owns the runtime" → "…when no official source exists at
all"). The bodies are unchanged — the *fallback* behaviour they cover is still
exactly right for Quick-Ask and the notifier. Its `afterEach` now also resets
the realm registry, taking care to reset only `source`/`unsubscribe` and to
leave `observers` in place: dropping the whole registry object would orphan the
statically-imported copy's refresh hook and silently break later cases in the
file.

---

## 5. Commit 2 — why it stopped, with the census

The brief: *"If commit 2's key-assignment turns out to be ambiguous for a
meaningful number of keys, STOP after commit 1, land it, and report the
ambiguous set with your proposed owners."* That is what happened. Two
independent reasons, either of which alone would justify it.

### 5.1 The key-assignment method, and its output

Not by prefix. A script walks `packages/`, `plugins/`, `apps/`, `bundles/`,
`scripts/`, `docs/` (excluding `node_modules`, `dist`, `lib`, `out`, `build`,
`resources`, `coverage`), extracts every dotted string literal from every
`.ts/.tsx/.mjs/.js` file, and intersects it with the 753 keys parsed out of
`packages/i18n/src/en.ts`. Each key's owner set is the set of workspace projects
whose *non-test* files mention it. Reproduction script: §10.

Two things make the intersection trustworthy here. There is **no dynamic key
construction**: a repo-wide scan for `` t(` `` and for `t(<identifier>)` returns
zero translation call sites (the seven `` t(` `` hits are all unrelated
`path`/`appendText`/`set` calls). And keys referenced indirectly through
constant tables (e.g. `labelKey: "channels.local"` in
`packages/app-runtime/src/core/channels.ts:20`) are caught, because the scan is
over string literals rather than over `t(...)` syntax.

**Zero-key-loss evidence, today (actually run, not asserted):** the same
intersection in the other direction — every `t("…")` call site against the union
of every dictionary in the repo (`packages/i18n/src/{en,zh-CN}.ts` plus the nine
plugin overlay files matching `src/client/i18n*.ts`) — over
`packages/`, `plugins/`, `apps/`:

```
dictionary files scanned: 11
distinct keys defined  : 977      (753 host + 224 plugin-overlay)
t("…") call sites      : 879
keys referenced but NOT defined: 3
  MISSING your.key                  <- packages/i18n/src/en.ts        (doc comment example)
  MISSING options.example.greeting  <- packages/i18n/src/plugin.test.ts (test fixture)
  MISSING options.example.doesNotExist <- packages/i18n/src/plugin.test.ts (test fixture)
```

All three are non-real: one is the `t("your.key")` in `en.ts`'s own how-to
comment, two are deliberate fixtures in `plugin.test.ts`. **0 genuine misses.**
That is the check that must stay green after a split, and it is the mechanical
form the brief asked for. Note it counts `t("…")` syntax (879) rather than
string literals, which is why it is a slightly different population from the
census above.

| owner (by actual use) | keys | notes |
| --- | --- | --- |
| `packages/ui` only | **443** | `sidepanel.*` 197, `options.*` 91, `workspacePane.*` 89, `chat.*` 17, `embeddedBrowser.*` 16, `newtab.*` 11, `workspace.*` 6, `commandPalette.*` 6, `composer.*` 4, `conversationRail.*` 3, + 3 singletons. Confirms the brief's warning: `sidepanel.*` is today's main chat surface, and `newtab.*`/`options.*` are browser-extension-era names on live UI code. |
| shared (used by ≥2 projects) | **17** | 10 × `common.*`, plus `notifier.dismiss`, `options.status.dsh.runtime`, `sidepanel.modelPicker.label`, `sidepanel.modelPicker.loadFailed`, `sidepanel.permission.allowOnce`, `sidepanel.permission.deny`, `chat.settings`. → shared UI namespace, not duplicated. |
| `plugins/dsh-plugin-model-plane` | **23** | 22 × `options.models.*` + `sidepanel.modelPicker.reasoningEffort`. The plugin already has its own `client/i18n.ts` overlay; these 23 belong in it. |
| `apps/desktop` | **9** | 7 × `notifier.*`, 2 × `quickAsk.actions.*`. Electron-only window copy, exactly as the brief predicted. |
| `plugins/dsh-plugin-messaging-core` | **3** | `common.add`, `common.confirm`, `common.copy` — shared vocabulary that happens to have a single consumer today. → shared UI namespace. |
| `packages/app-runtime` | **2** | `channels.local`, `channels.unknown`, referenced as `labelKey` in `core/channels.ts`. Data, not a rendering call site — needs a decision (§5.2). |
| `plugins/dsh-plugin-ui-shell` | **1** | `app.initializing`. |
| **tests only** | **8** | `embeddedBrowser.expand` + 7 × `sidepanel.trace.*`. `packages/ui/src/chat/__tests__/MessageChrome.test.tsx:1034` asserts the raw key is **not** rendered — so these are dead in production too. |
| **no reference anywhere** | **247** | §5.2. |
| total | **753** | |

### 5.2 The ambiguous set — 255 keys (34%) with no production call site

"Assign every key by ACTUAL USE" has no answer when there is no use. This is not
a handful of stragglers; it is a third of the dictionary, and disposing of it is
a product decision rather than a mechanical one.

| family | keys | proposed owner / disposition | why it needs a decision |
| --- | --- | --- | --- |
| `options.extensions.*` | 114 | **delete**, unless the out-of-tree `amiba-ext-knowledge-base` extension still resolves them | I cannot see that repo from this worktree. If it consumes host keys, deleting them breaks it silently — nothing in this build would catch it. |
| `sidepanel.trace.*` | 20 (+7 test-only) | **delete** | The trace surface is gone; its own test asserts the keys do not render. But this reads like a shelved feature someone may intend to revive. |
| `options.nav.*` | 7 | **delete** | browser-extension-era navigation. |
| `sidepanel.approvalMode.*` | 7 | **verify first, then delete** | approval mode is very much alive; these specific keys are not referenced, which suggests a rename left orphans. Worth a human look before deletion. |
| `sidepanel.message.*` | 6 | delete | |
| `sidepanel.pin.*`, `sidepanel.learn.*` | 10 | delete | |
| `newtab.*` | 15 | delete | extension new-tab page; the live `newtab.*` keys (11) stay with `packages/ui`. |
| `quickAsk.kbd.*` | 4 | **`apps/desktop`** | Quick-Ask copy with no current call site; the window is alive, so these plausibly belong to it rather than to the bin. |
| `workspacePane.*` orphans | 14 | delete | the live 89 stay with `packages/ui`. |
| `chat.*`, `options.models.*`, `common.*`, `app.*`, misc | ~58 | mostly delete | includes `common.enabled`/`disabled`/`on`/`off`/`all`/`error` — generic vocabulary that is cheap to keep and awkward to re-add. |

`packages/app-runtime`'s 2 keys are a smaller, sharper version of the same
problem: `core/channels.ts` stores `labelKey: "channels.local"` and something
downstream renders it. After a split, `@amiba/app-runtime` would be naming a key
in a namespace it does not own and cannot register into (it has no `ctx`). Its
proposed owner is the **shared UI namespace**, with `app-runtime` keeping only
the key string — but that is a coupling worth stating out loud rather than
assuming.

### 5.3 The prize, measured — and the second reason for stopping

Every emitted client bundle carries the complete host dictionary today:

| plugin bundle (`lib/client.js`) | size | host keys inlined | ≈ English dict |
| --- | --- | --- | --- |
| `dsh-plugin-runtime-inventory` | 267 KB | 751 / 751 | ~41 KB |
| `dsh-plugin-agent-preset` | 278 KB | 751 | ~41 KB |
| `dsh-plugin-mcp-manager` | 332 KB | 751 | ~41 KB |
| `dsh-plugin-memory` | 332 KB | 751 | ~41 KB |
| `dsh-plugin-catalog` | 333 KB | 751 | ~41 KB |
| `dsh-plugin-schedule-adapter` | 346 KB | 751 | ~41 KB |
| `dsh-plugin-usage` | 352 KB | 751 | ~41 KB |
| `dsh-plugin-messaging-core` | 357 KB | 751 | ~41 KB |
| `dsh-plugin-skills` | 357 KB | 751 | ~41 KB |
| `dsh-plugin-model-plane` | 501 KB | 751 | ~41 KB |
| `dsh-plugin-ui-shell` | 2384 KB | 751 | ~41 KB |

Both catalogs together are 91.5 KB of source (`en.ts` 46.4 KB, `zh-CN.ts`
45.1 KB), duplicated eleven times. `dsh-plugin-runtime-inventory` renders no
`useT` copy at all and still ships the whole thing.

**Good news for whoever picks this up: the purity assertion is checkable here.**
I expected the real bundling to happen only in `runtime:prepare` (which cannot
complete in this worktree — the known `dsh-llm` rc.8 ERESOLVE drift). It does
not: each plugin's `build` script is `tsc -p tsconfig.build.json && vite build`
and emits a self-contained `lib/client.js` with `@amiba/ui` and `@amiba/i18n`
inlined. `plugins/dsh-plugin-skills/lib/client.js` contains 265 distinct
`sidepanel.*` keys and both language variants of `common.save`. So a sentinel
assertion over `plugins/*/lib/client.js` after `pnpm -r build` is sound, and
acceptance 5 is provable without a live runtime. That blocker does **not** exist.

The blocker that does exist is a **design fork the brief does not settle**, and
it is the second reason I stopped.

`ctx.locale.register(NS, dicts)` gives one namespace exactly one owner —
upstream is explicit: *"Duplicate (ns, locale) throws (single occupant; a
namespace's texts have one owner)"*
(`@deepseek-ai/dsh-client-locale/lib/types/client/index.d.ts`). Lookup is
per-namespace: the entry's namespace, then that namespace's `zh` fallback, then
the framework-owned `common` namespace, then the key itself. Amiba cannot
register into `common`.

But `useT()` takes no namespace, and it has **three** distinct consumer groups
that the brief assigns to **three** different owners:

- `packages/ui` components (~60 files) → shared UI namespace;
- `plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx` → shell namespace;
- `apps/desktop` Quick-Ask / notifier → desktop namespace, **and no `ctx` at all**.

So `useT()` cannot bind a single namespace. The options are:

1. give `useT` a namespace argument — changes call sites, and the brief's
   commit-1 rule ("if your design requires changing them, you have taken the
   wrong approach") reads like it is meant to survive commit 2;
2. keep a realm-wide *list* of Amiba-registered namespaces in `@amiba/i18n` and
   walk it, detecting a miss by `result === key` — workable, and the dictionaries
   really do live in the official service, but it is Amiba inventing a
   resolution order on top of the official one;
3. adopt the official model literally — components receive `t` through injected
   props, per `locale: NS` on slot registrations — which is what the brief
   describes as the official shape, and which is a much larger refactor than
   "move dictionaries".

There is also a typing consequence in every branch: `MessageKey =
keyof typeof en` disappears with `en.ts`, and with it the compile-time key
checking at the 879 `t("…")` call sites, unless each owner re-exports its own typed `useT`
wrapper. Upstream's typed `register` overload *does* replace the both-language
parity guarantee (bilingual balance is enforced at registration), so acceptance
4 survives — but the key-existence guarantee needs a deliberate replacement.

Picking option 2 unilaterally, on top of deleting 255 keys unilaterally, is more
product decision than this task should absorb silently. Hence the stop.

---

## 6. What commit 2 should do, in order (for whoever takes it)

1. **Decide the 255.** Confirm `options.extensions.*` against
   `amiba-ext-knowledge-base` first; that is 114 of them and the only family
   whose deletion is not locally verifiable.
2. **Decide the `useT` resolution fork** (§5.3). Everything downstream depends
   on it.
3. Move `plugins/dsh-plugin-model-plane`'s 23 keys into its existing
   `src/client/i18n.ts` overlay — that plugin, plus schedule-adapter, usage,
   mcp-manager, messaging-core, skills, agent-preset and memory, already own
   overlay files and already call `usePluginT(overlay)`. The plugin half of the
   split is mostly done; what pulls the host catalog into those bundles is
   `@amiba/i18n/plugin`'s compile-time `CATALOG` fallback (steps 3–4 of
   `resolvePluginTemplate`), not the overlays.
4. `packages/ui` dictionary → `@amiba/ui/locales`, imported ONLY by the
   registering shell. Prove the entry-point separation with a sentinel string
   over `plugins/*/lib/client.js` (§5.3) and mutation-check it by importing the
   dictionary from a component file and watching the assertion fire.
5. `apps/desktop`'s 9 (+4 `quickAsk.kbd.*`) keys stay compile-time — those
   windows have no `ctx`, so acceptance 3 forces a local catalog there whatever
   the answer to fork §5.3 is.

---

## 7. Mutation checks

Six mutations, five caught, one negative control that correctly did not fire.
Every assertion added in commit 1 was broken, both gates re-run, and restored.
Gates: `node scripts/verify-dsh-architecture.mjs` and
`packages/ui` vitest (`i18n-cross-bundle-locale.test.tsx`).

| # | mutation | verify | tests | result |
| --- | --- | --- | --- | --- |
| M1 | drop `officialLocaleRegistry().observers.add(refreshLanguage)` (the install-notification list) | caught | 5 of 6 failed | **caught** |
| M2 | `OFFICIAL_LOCALE_KEY` stops being a realm symbol; the registry becomes a module-scoped object (the pre-change shape) | caught | 6 of 6 failed | **caught** |
| M3 | hoist `languageSubscribers` onto the realm registry | caught | 2 failed, `['zh-CN','zh-CN']` vs `['zh-CN']` | **caught** |
| M4 | subscribe only the installing copy (`source.subscribe(refreshLanguage)`, the old shape) | caught | 3 failed | **caught** |
| M5 | hoist `storeSubscribers` onto the realm registry | caught | — | **caught** |
| M6 | *(negative control)* prose-only edit naming every pinned identifier inside a doc comment | not caught | — | **correctly not caught** |

M3's symptom is worth recording because it is the exact failure the brief warned
about: with the subscriber set shared and the cache per-copy, each listener fires
once per bundle copy. Two copies, one switch, two notifications. M6 confirms
verify's `code()` comment stripper is applied to this file, so prose cannot
satisfy a pin.

---

## 8. Docs synced

- `docs/2026-08-15-dsh-native-architecture.md` §4.4 — the paragraph that said
  `document.documentElement.lang` is load-bearing *because ui-shell's
  `installOfficialLocale` cannot reach the other bundles* was the thing this
  change falsifies. Replaced with the realm-registry contract, the explicit
  global/not-global split, the install-notification list, and the four things
  the document attribute is still needed for.
- `packages/i18n/package.json` — the `description` still advertised "persists
  preference via `@amiba/app-runtime/platform`", which stopped being true one
  phase ago.
- `packages/extension-sdk/README.md` — checked, mentions no i18n path. No other
  doc in the repo references `@amiba/i18n`.

---

## 9. What I refused to fake

- **No live smoke.** `runtime:prepare` cannot complete in this worktree (the
  known upstream `dsh-llm` rc.8 / `dsh-attachment` rc.6 peer drift), so
  acceptance 1's canonical cross-bundle probe — switching the official row and
  watching the chat sidebar's 新建任务/New task retitle — was not run. The
  cross-bundle test is a real second module copy in a real React tree, but it is
  not the product.
- **`usePluginT` was left on the document contract.** Moving it onto the shared
  mirror is five lines, but its callers read the DOM synchronously at render
  (`packages/ui/src/settings/__tests__/DshPluginInventory.test.tsx` sets
  `documentElement.lang` and renders in the same tick), while the mirror's cache
  only advances on the MutationObserver's microtask. Making that work needs a
  lazily-reconciling snapshot, which silently swallows notifications for
  `subscribeLanguage` observers in one interleaving. I would rather report the
  document contract as still load-bearing for `usePluginT` (§1.3) than ship a
  subtle store bug to make a sentence in the report read better.
- **No commit-2 half-measure.** Extracting `packages/ui`'s dictionary without
  settling §5.3 would mean either a dead entry point nothing reads, or picking
  the resolution fork by implementation rather than by decision.
- **The 255 dead keys were not deleted as a side effect.** Especially the 114
  `options.extensions.*`, whose only plausible remaining consumer is a repo I
  cannot see from here.
- **The registry does not swallow errors.** `notifyRealm` iterates observers
  without a `try`/`catch`, matching the platform-adapter precedent. A throwing
  copy would stop the fan-out; a `catch` would hide it. Recorded rather than
  chosen silently.

---

## 10. Concerns

1. **The realm registry is now a shared mutable object with no version tag.**
   If two *different builds* of `@amiba/i18n` ever coexist in one renderer (a
   plugin pinned to an older workspace snapshot), they will share one registry
   whose shape they may not agree on. The symbol key carries no version. The
   platform-adapter precedent has the same property, so this is consistent
   rather than novel — but the blast radius grew.
2. **`observers` is add-only.** Copies never leave. That is correct for bundles
   (a copy lives as long as the realm) and it is what makes the test's registry
   cleanup delicate — see §4. A future `disposeLocaleCopy` would be dead code
   in production and a footgun in tests.
3. **The document attribute is still written on every switch**, so an accidental
   `documentElement.lang` write by unrelated code still perturbs `usePluginT`
   and the nine slot-label readers for an observer tick. Commit 1 removed that
   exposure for `useT` only.
4. **34% of the dictionary is dead** and nothing in the build says so. Whatever
   happens to commit 2, the census in §5.1 is worth landing as a verify rule on
   its own — an unreferenced key is a key someone will translate for nothing.
5. **`getCurrentLanguage` / `subscribeLanguage` finally have consumers** — the
   new test uses both — but still no production caller. The previous phase's
   report flagged them for deletion; they are now load-bearing for the
   cross-bundle guard, which is a weak reason to keep a public API.
6. **`sidepanel.approvalMode.*` (7 keys) being unreferenced while approval mode
   is a live feature** looks like a rename that left orphans rather than a
   removed surface. Worth a look independently of the i18n work.

---

## 11. Reproducing the census

Not committed as repo tooling — it is analysis, not a gate. Save as
`keymap.mjs` outside the tree and run `node keymap.mjs /path/to/amiba`.

The zero-key-loss check of §5.1 is the same walk with the loop inverted:
collect `defined` from every file matching
`packages/i18n/src/(en|zh-CN).ts` or `src/client/i18n*.ts` (pattern
`/^\s+"([^"]+)":\s*["`]/gm`), then scan every `.ts`/`.tsx` for
`/\bt\(\s*"([^"]+)"/g` and report the keys not in `defined`. That one IS worth
promoting into `scripts/` once the split happens — it is the assertion that
"no surface renders a raw key" after dictionaries stop being one compile-time
object.

```js
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2];
const SKIP = ["node_modules", "dist", "lib", "out", "build", "resources", "coverage"];

async function sourceFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.includes(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await sourceFiles(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const enSrc = await readFile(path.join(root, "packages/i18n/src/en.ts"), "utf8");
const keys = [...enSrc.matchAll(/^\s{2}"([^"]+)":/gmu)].map((m) => m[1]);
const keySet = new Set(keys);
const usage = new Map(keys.map((k) => [k, new Map()]));

const files = [];
for (const r of ["packages", "plugins", "apps", "bundles", "scripts", "docs"]) {
  try { files.push(...(await sourceFiles(path.join(root, r)))); } catch {}
}

for (const file of files) {
  const rel = path.relative(root, file);
  if (rel.startsWith("packages/i18n/src/en.ts")) continue;
  if (rel.startsWith("packages/i18n/src/zh-CN.ts")) continue;
  const parts = rel.split(path.sep);
  const owner = ["packages", "plugins", "apps", "bundles"].includes(parts[0])
    ? `${parts[0]}/${parts[1]}`
    : parts[0];
  const tag = /(__tests__|\.test\.|\/test\/)/.test(rel) ? `${owner} (test)` : owner;
  const src = await readFile(file, "utf8");
  for (const [, lit] of src.matchAll(/["'`]([a-zA-Z][\w.-]*\.[\w.-]+)["'`]/gu)) {
    if (!keySet.has(lit)) continue;
    const m = usage.get(lit);
    m.set(tag, (m.get(tag) ?? 0) + 1);
  }
}

for (const key of keys) {
  const owners = [...usage.get(key).keys()];
  const prod = owners.filter((o) => !o.endsWith("(test)")).sort();
  console.log(key, "\t", prod.length ? prod.join(" + ") : "UNUSED");
}
```
