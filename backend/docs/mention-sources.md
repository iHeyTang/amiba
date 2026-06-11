# Mention sources — author guide

A **mention source** lets the amiba desktop composer `@`-mention an external
system's resources (a Feishu doc, a Notion page, a Jira ticket…). The user picks
a resource from a typeahead; it's inserted into the message as a self-describing
handle; the agent resolves that handle on demand.

## What it is — and isn't

A mention source fills the one gap hermes-agent **can't**: the desktop
composer's @-mention discovery. hermes has no UI, so it can't search external
resources for a typeahead.

It is **not** a hermes "integration" / connector. Everything else a real
connector does, hermes already has natively — don't rebuild it in a mention
source:

| Want… | Use hermes's… |
|---|---|
| the agent to **act** on an external system | `hermes plugins` (tools) / `hermes mcp` (MCP servers) / skills |
| an external system to **drive** the agent (events) | `hermes platforms` (feishu/slack/…) / `hermes webhook` / `hermes cron` |
| **auth / connection** to an external system | `hermes auth` / `secrets` / `login` |

A mention source only does **discovery for the composer** (`search`) plus a thin
**resolver skill** that bridges a picked handle to one of the above.

## The four pieces

Scaffold them with the CLI:

```bash
pnpm amiba create-mention-source notion --description "Notion pages"
```

That produces a directory (a git repo) with:

```
notion/
├── __init__.py          # re-exports `search` (the loader grabs it)
├── source.py            # implement `search(rtype, query, limit)`
├── mention-source.yaml  # declare the @ types + fields + serialize
└── skills/
    └── resolve.md       # teach the agent to act on a picked handle
```

### 1. `source.py` — the only required code

```python
async def search(rtype: str, query: str, limit: int = 8) -> dict:
    # rtype is one of the `type`s in your manifest (e.g. "page").
    # Return {"ok": True, "items": [ {id, title, detail, payload}, ... ]}.
    # NEVER raise — return empty on miss/error; the composer just shows nothing.
```

Each item:

| key | meaning |
|---|---|
| `id` | stable unique id |
| `title` | main text in the `@` menu |
| `detail` | secondary grey text (optional) |
| `payload` | a dict whose keys are a **superset of the manifest `fields`** |

HTTP-agnostic: never import aiohttp. Search however you like (HTTP, SDK, a CLI
subprocess).

### 2. `mention-source.yaml` — declare the `@` types

```yaml
name: notion
version: 0.1.0
description: Notion pages
group: Notion                       # optional: default @-menu section for this source's types

mention_resources:
  - type: page                      # → search(rtype="page", ...) ; /mention-sources/notion/search?type=page
    label: Notion 页面
    icon: notion-page
    group: Notion 页面               # optional: this type's @-menu section (overrides the source-level default)
    trigger: "@"                    # optional: "@" (default) or "/"
    fields: [url, title]            # ← must match the keys in each item's `payload`
    serialize: "[Notion] {title} — {url}"   # the handle inserted on pick

resolver_skill: skills/resolve.md
requires:
  binaries: []                      # optional: external commands you shell out to
```

**The contract that ties it together:** `payload` keys ⊇ `fields`, and
`serialize` interpolates `{field}` from the payload. When the user picks a
candidate, the composer expands `serialize` into the message — that line is the
handle the agent resolves.

**Grouping (`group`).** The composer's `@`-menu clusters candidates into
sections by a raw label string. A type's section is resolved in order: its own
`group` → the source-level `group` default → the source name. Types that
resolve to the **same string** — even across different sources — share one
section, so set `group` to a new string to open your own section, or match an
existing section's string to file into it. `trigger` selects which menu a type
appears under: `@` (default) or `/`.

### 3. `skills/resolve.md` — bridge the handle to an action

A normal hermes skill (frontmatter `name` / `description` / `when_to_use` + a
body). It tells the agent: when you see `[Notion] <title> — <url>`, here's how to
read/act on it. **Prefer an existing hermes plugin / MCP / skill** for the actual
read/write; the resolver is just glue. The source's `skills/` dir is wired into
the agent's `skills.external_dirs` automatically on load.

### 4. `__init__.py`

```python
from .source import search  # noqa: F401
```

## Install + maintain

There are **two install methods**, recorded per-source in
`~/.hermes/mention-sources/.registry.json` so `update` does the right thing:

| Method | What it does | `update` |
|---|---|---|
| **`from_path`** (dev) | **symlinks** to your local repo — editable, like `pip install -e`. Edits are live. | **reload** (re-import the live code; no git) |
| **`from_git`** | `git clone` into the dir (a real checkout). | **`git pull`** |

```bash
# editable dev install (symlink — edit the repo, then Reload):
curl -XPOST 127.0.0.1:9394/hermes/mention-sources \
  -d '{"from_path":"'$PWD'","name":"notion"}'

# install from a published repo (versioned via git):
curl -XPOST 127.0.0.1:9394/hermes/mention-sources \
  -d '{"from_git":"https://github.com/you/amiba-source-notion"}'

# update (dispatches on the recorded method) / remove:
curl -XPOST   "127.0.0.1:9394/hermes/mention-sources/update?name=notion"
curl -XDELETE 127.0.0.1:9394/hermes/mention-sources/notion
```

Sources live under `~/.hermes/mention-sources/<name>/` (a symlink for a
`from_path` install). The desktop **Settings → Mention Sources** panel drives the
same routes and shows each source's origin + a Reload/Update button.

## Verify

```bash
curl 127.0.0.1:9394/hermes/mention-sources                       # admin list (has_search should be true)
curl 127.0.0.1:9394/hermes/mention-resources                     # should list notion.page
curl '127.0.0.1:9394/mention-sources/notion/search?type=page&q=hi'  # should return items
```

If `has_search` is false, your `__init__.py` probably didn't re-export `search`
(the backplane logs a warning on load).

## HTTP surface (served by the backplane)

| Route | Purpose |
|---|---|
| `GET /mention-sources/<name>/search?type=&q=&limit=` | call a source's `search` |
| `GET /hermes/mention-resources` | flattened registry for the composer's `@` providers |
| `GET /hermes/mention-sources` | admin: list loaded sources |
| `POST /hermes/mention-sources` | admin: install `{from_git\|from_path, name?, ref?, overwrite?}` |
| `POST /hermes/mention-sources/update?name=` | admin: `git pull` + re-import |
| `DELETE /hermes/mention-sources/<name>` | admin: remove |

`/integrations/<name>/search` remains as a legacy alias.
