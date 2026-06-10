---
name: mention-sources-management
description: >
  Install / update / remove desktop @-mention sources by calling the local
  backplane admin API on 127.0.0.1:9394. Use ONLY when the user explicitly asks
  to add/update/remove a mention source AND gives a concrete git URL or path.
when_to_use: >
  The user explicitly asks to install / update / remove a "mention source" (a
  source they can @-mention in the desktop composer, e.g. a Feishu or Notion
  source) and provides the git URL or local path. Do NOT use this to resolve a
  mentioned handle — that's the per-source resolver skill.
---

# Managing mention sources

A **mention source** lets the desktop composer `@`-mention an external system's
resources. Each source is a git repo under `~/.hermes/mention-sources/<name>/`.
Lifecycle is the **local backplane** on `127.0.0.1:9394` (a loopback HTTP
server) — git under the hood.

## ⚠️ Safety — read before installing

Installing a source **clones a git repo and the backplane then imports +
executes its Python**. So:

- Install **only** from a URL/path the **user explicitly gave you in this
  conversation**. Never guess, search for, or infer a URL.
- **Confirm with the user** before installing ("Install the mention source from
  `<url>`? It will run code from that repo.") and proceed only on a clear yes.
- Prefer pointing the user at **Settings → Mention Sources** (the UI does the
  same thing) for anything non-trivial.

## Commands (shell out with curl)

List what's installed:

```bash
curl -s 127.0.0.1:9394/hermes/mention-sources
```

Install from a git URL (`git clone`), or a local path (an **editable symlink**,
for dev):

```bash
curl -s -XPOST 127.0.0.1:9394/hermes/mention-sources \
  -H 'content-type: application/json' \
  -d '{"from_git":"<url the user gave>"}'
# local path:  -d '{"from_path":"<dir the user gave>","name":"<name>"}'
```

Update / remove. `update` dispatches on how the source was installed — `git
pull` for a git install, a live reload for a local-path (symlink) install — so
you don't need to know which; just call it:

```bash
curl -s -XPOST   "127.0.0.1:9394/hermes/mention-sources/update?name=<name>"
curl -s -XDELETE "127.0.0.1:9394/hermes/mention-sources/<name>"
```

## After acting

- A successful install/update returns `{"ok": true, "name": ...}`. If the
  response carries `load_warning` (or `has_search` is false in the list), the
  source loaded but exposes no `search` — tell the user its @-mentions won't
  return anything until its `__init__.py` re-exports `search`.
- An error returns a JSON `error`/`detail` — relay it; don't retry blindly.
- The change takes effect immediately (no restart) for the composer's `@`
  picker; the agent-side resolver skill is picked up on the next gateway start.

## Not this skill's job

Connecting the agent to act on an external system (send a message, create a
ticket) is **not** done here — that's a hermes `plugin` / `mcp` server / skill.
A mention source only feeds the composer's discovery.
