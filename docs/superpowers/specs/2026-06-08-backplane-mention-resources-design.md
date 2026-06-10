# Backplane Mention-Resource Extension — Design

**Date:** 2026-06-08
**Status:** Approved (design), implementation in progress
**Builds on:** [2026-06-05 composer-slash-and-mentions](./2026-06-05-composer-slash-and-mentions-design.md)

## Problem

We want to `@`-mention **arbitrary injected resources** in a chat — a Feishu
(Lark) group, a Feishu doc, a person — and have the agent act on them. The
existing composer mention system (`packages/ui/src/chat/composer/`) only
supports a **closed** set of mention types (`skill | session | persona |
channel | file | page`), hardcoded in `serialize.ts` (`KNOWN` / `FIELDS`) and
`providers/types.ts` (`MentionType`). There is no way for an external
integration to register a new mentionable resource type.

Separately, the `http-backplane` plugin already ships an unused
`/integrations/*` lane (catch-all dispatcher + loader/manager + a bundled
`lark` preset + `hermes integration` CLI + `skills/` → `external_dirs`
auto-load). It was built but never wired to a consumer. This feature gives it
its job.

## Decisions (locked)

1. **Scope — general registerable mechanism.** Not "just add Feishu". The
   closed mention-type set becomes an open registry; the `/integrations/*`
   lane becomes the unified resource backend. Feishu is the first instance.
2. **Injection semantics — handle + agent resolution.** A mention expands (in
   the frontend send layer, as today) into a *self-describing reference line*
   the agent sees, e.g. `[飞书文档] 标题 — https://…feishu.cn/docx/…`. The
   agent resolves/acts on it on demand. The backend never parses `@[...]`.
3. **Resolver — integration-shipped.** The registration contract formally
   includes an agent-side resolver: each integration ships a `skills/*.md`
   that teaches the agent how to act on its handle types. Delivered via the
   existing `skills.external_dirs` mechanism. hermes-agent core is untouched.
4. **Host-independent.** The capability depends only on the backplane
   contract (`/hermes/mention-resources` + `/integrations/<name>/search`) plus
   a running Hermes process hosting the backplane (`hermes chat` alone
   suffices) and a graphical composer host (extension / web / desktop).
   Desktop is **not** required; the browser extension is the primary consumer.
5. **Placement — backplane-native (方案 1).** The mechanism is a native
   `http-backplane` feature. hermes-agent / the generic plugin-API /
   agent-tools are all untouched. Desktop/extension/web are consumers. This
   is the textbook use of the backplane's "bridge upstream agent + implement
   our own special features" role, and is the correct precursor to any future
   upstream proposal (`/api/*` ↔ our `/hermes/*` mirror).
6. **Purity — single source (option A).** The framework ships **zero** bundled
   integrations. The `presets/` tier is removed entirely; the only
   integration source is `~/.hermes/integrations/<name>/`. `lark` is extracted
   to its own package and installed via the public path, becoming the
   dogfood / first real instance that proves the contract is genuinely
   third-party-installable (a bundled preset can cheat with in-tree imports;
   a publicly-installed one cannot).
7. **Distribution — git-installable.** `hermes integration install` gains a
   git source so an integration can live as its own repo. `lark` becomes
   `amiba-integration-lark` (repo creation/push is the operator's manual
   distribution step, per the ecosystem distribution phases).

## Architecture

```
Composer (packages/ui, host-agnostic)
  └─ on @: build N generic TriggerProviders from the registry
        search(q) ─HTTP→ GET /integrations/<name>/search?type=<t>&q=…
        serialize(m)  → apply declared template → "[飞书文档] 标题 — url"
  └─ on send: expandMentions() turns @[lark.doc:…] into the reference line
                                                   (backend never sees @[...])
        │
        ▼
http-backplane (the framework)
  ├─ GET /hermes/mention-resources   ← aggregates every installed integration's
  │       integration.yaml: mention_resources[]  (single source of truth)
  ├─ /integrations/<name>/search     ← per-integration search handler
  └─ on install: integration's skills/ → skills.external_dirs
        │
        ▼
Agent (hermes core, unchanged)
  └─ sees the reference line → resolver skill (from the integration) tells it
     how to read/act (e.g. shell out to lark-cli / existing lark-* skills)
```

### The integration package (contract)

Single source `~/.hermes/integrations/<name>/`:

```
~/.hermes/integrations/lark/
├── integration.yaml       # declares mention_resources[] + resolver_skill
├── __init__.py            # from .handler import setup
├── handler.py             # search backend (HTTP), already exists for lark
├── lark_cli.py            # subprocess wrapper (lark-specific)
└── skills/lark-resolve.md # agent-side resolver
```

`integration.yaml` new section:

```yaml
name: lark
version: 0.2.0
mention_resources:
  - type: doc                                    # registry key = "lark.doc"
    label: 飞书文档
    icon: lark-doc
    fields: [url, title]                         # token payload field order
    serialize: "[飞书文档] {title} — {url}"       # → agent-visible reference
  - type: chat
    label: 飞书群
    fields: [chat_id, name]
    serialize: "[飞书群] {name} (chat_id={chat_id})"
  - type: user
    label: 飞书联系人
    fields: [p2p_chat_id, name]
    serialize: "[飞书联系人] {name} (chat={p2p_chat_id})"
resolver_skill: skills/lark-resolve.md           # optional; documentation hint
```

### The two HTTP interfaces

- **Aggregation** `GET /hermes/mention-resources` → flat registry of every
  installed integration's declared resources:
  ```json
  { "resources": [
    { "key": "lark.doc", "integration": "lark", "type": "doc",
      "label": "飞书文档", "icon": "lark-doc", "trigger": "@",
      "fields": ["url","title"], "serialize": "[飞书文档] {title} — {url}",
      "search": "/integrations/lark/search?type=doc", "group": "lark" }
  ] }
  ```
  Reads from the loader's in-memory `LoadedIntegration.meta`. Single source of
  truth, mirrors the slash/personalities "fetch live, no copy drift" pattern.

- **Search** `GET /integrations/<name>/search?type=<type>&q=<query>&limit=N` →
  `{ items: [{ id, title, detail, payload }] }`. Always HTTP 200; degrade to
  empty list on missing-binary/timeout/unconfigured (existing lark behaviour).
  lark's current `/search` (returns `{chats, users, docs}` at once) is
  adapted to dispatch on `type`.

### Token / serialize generalization (TS)

- Token: `@[<key>:<body>]` where `<key>` is a registry key
  (`lark.doc`). Built-ins (`skill`, `session`, …) keep their bare keys.
  `TOKEN_RE` widens from `[a-z]+` to `[a-z][a-z0-9.]*`.
- `serialize.ts` `KNOWN`/`FIELDS` change from hardcoded constants to a
  **registry lookup**: built-in field map first, else the dynamic registry
  fetched from `/hermes/mention-resources`. `decode()` resolves fields from
  whichever source owns the key.
- Expansion stays in the send layer (`expandMentions`), per-provider
  `serialize()`; backend remains `@[...]`-unaware (composer spec §7 invariant).

### Composer generic providers (TS)

At composer init, fetch `/hermes/mention-resources`; for each entry build a
`TriggerProvider`: `trigger`, `id=key`, `group`, `search()` → the entry's
`search` URL via the backplane client, `onSelect` inserts a chip with
`MentionData{type:key,payload,display}`, `serialize()` applies the entry's
template, `ownsType=key`. Constructed entirely in `packages/ui` from the
registry — no per-host, no per-integration TS. Built-in providers stay as-is.

### Resolver delivery

Extend the plugin's existing `_ensure_skills_dir_in_external_dirs()` (which
adds the plugin's *own* `skills/`) to **also** add each installed integration's
`~/.hermes/integrations/<name>/skills/` dir to `skills.external_dirs`. So
`hermes integration install lark` ⇒ the agent auto-learns `lark-resolve`,
core unchanged.

### git-install (CLI)

`hermes integration install` gains:
- `--from-git <url> [--ref <branch|tag|sha>] [--subdir <path>]` — clone to a
  cache, optionally descend into `<subdir>`, install like `--from-path`.
- **Name from manifest** for `--from-git` / `--from-path`: read
  `integration.yaml:name` instead of requiring the positional `name`
  (positional becomes optional; manifest wins; mismatch errors).
- Record provenance `source: {git, ref(resolved sha), subdir}` in the
  installed dir (e.g. `.source.json`) so a later `update` can re-pull. (v1:
  record provenance; `update` is a thin follow-up.)
- Trust note: clone+import = code execution, but `hermes integration` is an
  operator CLI (not an agent tool) — consistent with the existing boundary;
  surfaced in `--help`.

## Repo changes

**`http-backplane`**
- `runtime/features/integrations/loader.py` — delete preset discovery/load
  (`_PRESETS_PACKAGE`, `_discover_preset_names`, `_load_preset`,
  `_resolve_preset_path`, the preset loop). Single source = user dirs.
- `runtime/features/integrations/manager.py` — drop `NameReserved` /
  `_preset_names()` checks; add git source + name-from-manifest to `install`.
- delete `runtime/features/integrations/presets/` (incl. `presets/lark`).
- `runtime/features/hermes_proxy/` — new `mention_resources` route module
  registered in `hermes_proxy/__init__.py`.
- `__init__.py` — extend `_ensure_skills_dir_in_external_dirs()` to include
  installed integrations' `skills/` dirs.
- `cli.py` — `--from-git` / `--ref` / `--subdir`, optional `name`.
- `tests/` — add coverage for aggregation, git-install, preset removal,
  external_dirs extension.

**`amiba-integration-lark`** (new standalone package; repo push = operator)
- `integration.yaml` (+ `mention_resources`), `__init__.py`, `handler.py`
  (search dispatch on `type`), `lark_cli.py`, `skills/lark-resolve.md`.

**`amiba` (TS monorepo)**
- `packages/ui/src/chat/composer/serialize.ts` — registry-driven decode.
- `packages/ui/src/chat/composer/providers/` — generic registry provider
  builder; `types.ts` `MentionType` widened to `string` for registry keys.
- host wiring (extension first) pulls the registry into `mentionProviders`.

## Build order

1. **Backplane core** — preset removal, external_dirs extension,
   `/hermes/mention-resources`, git-install + name-from-manifest, tests.
2. **lark** — extract to standalone package, declare resources, search
   dispatch on `type`, resolver skill; install via public path.
3. **TS** — serialize generalization, generic provider builder (rides the
   `feat/composer-slash-and-mentions` branch), host wiring.
4. **Verify** — extension `@` → pick Feishu doc → reference line in message →
   agent resolves via `lark-resolve`.

## Non-goals / YAGNI

- Backend parsing of `@[...]` tokens (expansion stays client-side).
- A privileged "preset" tier (removed).
- Per-keystroke MCP calls for search (MCP is agent-facing, wrong for
  typeahead — see 方案 B rejected).
- hermes-agent core changes (the contract is entirely backplane + skill).

---

## v2 — HTTP-agnostic integration protocol + two-plugin split

After v1 shipped (integration framework bundled in the backplane, integrations
HTTP-coupled via `setup(router)`), the design was sharpened so the backplane
becomes a *uniform* adapter over upstream and the integration contract drops
HTTP entirely.

**New shape (3 layers):**

```
hermes-agent plugin system
  ▲ register(ctx)
amiba-plugin-integrations   = the integration protocol + `hermes integration`
                                 CLI + loader + in-process capability registry +
                                 resolver-skill external_dirs wiring. NO HTTP.
  ▲ integration protocol (search + manifest + skill)
~/.hermes/integrations/<name>/  e.g. amiba-integration-lark
                                 = async search(rtype,q,limit)->{ok,items} +
                                   integration.yaml(mention_resources) + skills/

amiba-plugin-http-backplane = pure HTTP adapter. /hermes/* (compat over core)
                                 + integrations_gateway: /integrations/<name>/search
                                 (calls the integration's in-process search),
                                 /hermes/mention-resources, /hermes/integrations*
                                 admin. Reads the integrations plugin's registry
                                 in-process; degrades gracefully if absent.
```

**Why:** an integration's core purpose isn't to expose HTTP — it's a capability
declaration. Making it HTTP-agnostic means lark is plain domain logic (no
aiohttp), the backplane is the *only* HTTP owner, and the backplane's role is
uniformly "wrap upstream → webapi" for both lanes (resolving the v1 "origin vs
compat" split-role). The dependency inverts correctly: backplane → integrations
(adapter depends on upstream), in-process, same Hermes process.

**Contract change:** integration exposes a module-level `async search(rtype,
query, limit) -> {ok, items}` (loader grabs it) instead of `setup(router)`. The
backplane's generic `/integrations/<name>/search` adapter calls it. Composer
URLs are byte-identical, so the TS side is unchanged.

**Trade-off:** integrations can no longer mount arbitrary HTTP routes (only the
known `search` capability). This is intentional — it sharpens the boundary:
capability-shaped → integration; needs bespoke HTTP / tools / hooks → a full
Hermes plugin.

**Repo deltas:** new `amiba-plugin-integrations` (loader/manager/cli/registry
+ integration-management skill); backplane loses `runtime/api.py`,
`runtime/dispatch.py`, `cli.py`, `runtime/features/integrations/`,
`integrations_admin`, `mention_resources`, and gains
`hermes_proxy/integrations_gateway`; lark drops `handler.py`, `__init__`
re-exports `search`. Validated in-process (backplane imports + builds app,
gateway bridges to the plugin, search + mention_resources) + pytest (backplane
11, integrations plugin 6).
