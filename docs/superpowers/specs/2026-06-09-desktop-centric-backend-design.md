# Desktop-Centric Backend — Design

**Date:** 2026-06-09
**Status:** Direction approved; implementation pending

## The pivot

Flip the model: **desktop is the core; everything extends outward from it.**

- **Old:** hermes-agent is the core; desktop is a thin client of an external
  hermes. The backplane co-locates inside the gateway process as a "plugin"
  (it registers no tools/hooks/CLI — it's a service wearing a plugin costume,
  using `register(ctx)` purely to get into the gateway's process, since the
  plugin loader is the *only* door into that process).
- **New:** desktop is the **process supervisor**. It already spawns the gateway;
  it now also spawns the backplane **as an honest standalone HTTP server**. The
  plugin costume comes off entirely.

Why this resolves the long-standing "is it a service or a plugin?" ambiguity:
the costume was a workaround for having no supervisor. Desktop supplies the
supervisor, so the backplane becomes the server it always was. Cost = one more
child process — trivial for a supervisor that already manages the gateway.

## Topology

```
desktop  (Electron; process supervisor)
 ├─ spawn + supervise ─→ gateway (hermes-agent runtime: chat / LLM / tools)
 └─ spawn + supervise ─→ backplane server (127.0.0.1:9394, single front door)
        ├─ /hermes/*            served here (file-backed views over ~/.hermes/;
        │                        needs hermes-agent importable; NO live agent)
        ├─ /integrations/* + /hermes/mention-resources   served here
        │                        (the backplane loads integrations itself)
        └─ /v1/*                reverse-proxied to the gateway (chat/SSE)
```

- Clients (desktop renderer, chrome extension) still talk to **one** base URL
  (9394). The backplane fans out internally.
- `/hermes/*` is a file-backed control/view surface over `~/.hermes/` — it does
  NOT need a running agent, only the hermes-agent **Python package importable**
  + the data dir. So the backplane server runs in the same Python env as the
  gateway.
- `/v1/*` (the only agent-dependent lane) proxies to the gateway. Gateway down
  → `/v1/*` 502s gracefully; `/hermes/*` keeps working. No startup-order
  coupling.

## Component changes

### 1. `http-backplane`: de-plugin-ify → standalone server

- **Remove the plugin entry-point**: drop `plugin.yaml` + the
  `[project.entry-points."hermes_agent.plugins"]` + the `register(ctx)` path.
  Keep `runtime/server.py` (`python -m hermes_plugin_http_backplane.server
  --port 9394`) as the launch entry — it already exists.
- It is **no longer installed via `hermes plugins install`**. Desktop spawns it
  directly. Reposition it (name/docs) as **"desktop backend server"**, not a
  plugin. (We already documented it as "a service, not a capability plugin" —
  this completes that.)
- `/integrations/*` lane: when it was a plugin it could read the integrations
  plugin's in-process registry. As a standalone server it **loads integrations
  itself** (file-backed `~/.hermes/integrations/`) at startup — i.e. it imports
  `hermes_plugin_integrations.loader` and calls `load_all()` in its own process.
- Everything else (the route modules, the `/v1/*` reverse-proxy to
  `GATEWAY_BASE`) is unchanged.

### 2. Desktop: supervise two children, not one

- `apps/desktop/src/main/hermes-runtime.ts` today probes for `hermes`,
  auto-installs the iHeyTang plugins (`hermes plugins install …`), and
  supervises `hermes gateway`. Rework:
  - Drop the `hermes plugins install http-backplane` step.
  - Spawn + supervise **two** processes: the gateway (as now) and the backplane
    server (`python -m hermes_plugin_http_backplane.server`). Health-check +
    restart each.
  - Keep auto-installing `browser-tools` (still a plugin, see below).

### 3. `browser-tools`: stays a plugin, gets a first-class Settings entry

- `browser-tools` remains a hermes plugin loaded into the gateway (it registers
  `my_browser_*` tools + a WS hub — it genuinely extends the agent, so plugin is
  the right form).
- Surface it in Settings as a **dedicated entry with an enable/disable toggle**,
  backed by the `plugins.enabled` toggle / `/hermes/plugins` endpoint built
  2026-06-09 — promoted out of the generic Plugins list into its own first-class
  control.

## Open decisions (deferred — not blockers for the de-plugin-ification)

1. **Bundle vs external Python.** Does desktop **bundle** Python + hermes-agent
   (true self-contained "one app"), or require/drive an **external** hermes
   install (lighter, but assumes the user installed hermes)? The backplane-as-
   server design works either way (desktop spawns from whichever Python env has
   hermes-agent). This is the heaviest decision (bundling Python + owning its
   update story) — own spec when we get there.
2. **Code location.** Does the backplane Python code **move into the hermes-x
   monorepo** (accepting the Python-in-pnpm-repo toolchain mix the prior memo
   warned about) or stay a **separate repo** desktop vendors/spawns at build
   time? The de-plugin-ification can land in its own repo first regardless.

## Non-goals

- Rewriting the gateway/agent — it stays the Python runtime that runs chat; we
  only change how the backplane relates to it.
- Changing `/hermes/*` semantics (still file-backed views).
- Removing `browser-tools`'s plugin form (it earns it — registers tools).

## Build order (once open decisions are set)

1. Backplane: remove plugin entry-point; make `server.py` load integrations
   itself; verify `python -m …server` serves `/hermes/*` + `/integrations/*`
   standalone and proxies `/v1/*`.
2. Desktop: rework `hermes-runtime.ts` to spawn+supervise the backplane server
   alongside the gateway; drop its plugin-install step.
3. Settings: promote `browser-tools` to a dedicated enable/disable entry.
4. (Later) decide + implement bundling + code-location.

---

## Amendment (2026-06-09): code location + rename resolved

Open decision #2 (code location) is decided: the backplane is **internalized
into the monorepo at `hermes-x/backend/`** as a Python subpackage (NOT a pnpm
workspace package — pnpm ignores it; it has its own `pyproject.toml`). The
separate `hermes-x-plugin-http-backplane` repo is retired (was never pushed).

- Import package renamed `hermes_plugin_http_backplane` → **`hermes_x_backplane`**;
  distribution `hermes-x-plugin-http-backplane` → **`hermes-x-backplane`**. The
  console script `hermes-x-backplane` (what desktop spawns) is unchanged.
- This also resolves the install **source** (open decision #1's sibling): it's
  **local/bundled** — desktop ships `backend/` as an electron-builder
  `extraResources`, and onboarding `pip install`s it into the hermes Python env
  (creating `hermes-x-backplane` in that env's bin, which `hermes-runtime.ts`
  already spawns). Dev: `pip install -e backend` into the hermes env. (Bundle-vs-
  external Python — open decision #1 proper — is still deferred; external for now.)

Remaining to close the runtime gap: add the `pip install backend/` step to
desktop onboarding so `hermes-x-backplane` exists before the spawn.
