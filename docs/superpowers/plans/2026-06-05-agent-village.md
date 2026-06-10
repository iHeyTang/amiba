# Agent Village Extension — Implementation Plan (in-monorepo v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A amiba desktop extension (`io.hermes.agent-village`) that renders a Stardew-Valley-style pixel "village" showing what the current agent (and its sub-agents) are doing in real time, plus a pixel-styled stats panel.

**Architecture:** Clean split between **"算什么" (main-side logic, unit-tested)** and **"怎么画" (PixiJS renderer, consumes WorldState)**. Main subscribes to `host.chat.onEvent` (live main-agent activity) + polls `host.hermes.listSessions()` (village population incl. parent/child sub-agents), synthesizes a `WorldState`, and exposes it + aggregated `VillageStats` via IPC. The webview polls (~800ms; pauses on `document.hidden`), a PixiJS ticker tweens villagers toward their target stations. **v1 art = procedural placeholder graphics** (Pixi `Graphics`, zero external assets) behind an `assets-manifest` seam so CC0 sprite packs can drop in later.

**Tech Stack:** TypeScript, React 18, PixiJS ^8 (bundled into the UI), `@amiba/ui` (Heatmap/ChipSwitcher/Button/ScrollArea/cn — available in-monorepo via `workspace:*`), vitest, Vite (main+ui), Tailwind preset.

**Branch:** `feat/agent-village` (rebased onto current `main` with WS1+WS2). **Spec:** `docs/superpowers/specs/2026-06-05-agent-village-design.md`.

**Commit identity:** author all commits as `iHeyTang <dehui1012@gmail.com>` (`-c user.name=iHeyTang -c user.email=dehui1012@gmail.com`).

**Template:** mirror `extensions/tool-meter/` for all build config (vite.main.config.ts / vite.ui.config.ts / tsconfig.json / postcss / tailwind / shared/hermes-bridge.ts / shared/i18n.ts). Manifest carries `apiVersion: 1` (per WS1).

**Honest caveats (state in the final report, NOT a reason to skip):** (a) art is procedural placeholder, not CC0 — the `assets-manifest` seam is where real sprites land later; (b) sub-agent "current tool" is approximate (from `listSessions` polling, per spec §3); (c) runtime/visual verification needs the user to run the desktop app — this plan verifies build + typecheck + unit tests only.

---

## File Structure

```
extensions/agent-village/
  manifest.json  package.json  tsconfig.json
  postcss.config.cjs  tailwind.config.cjs
  vite.main.config.ts  vite.ui.config.ts
  assets/CREDITS.md
  src/
    main/
      index.ts            # activate: subscribe events + poll-synthesis + expose ipc
      world.ts            # buildWorldState() — PURE
      events-store.ts     # event day-buckets in host.storage + PURE aggregation
      stats.ts            # buildVillageStats() — PURE (listSessions + events)
    shared/
      hermes-bridge.ts    # window.hermes typed accessor (copy tool-meter)
      i18n.ts             # useT/useTheme (copy tool-meter)
      tailwind.css
      types.ts            # WorldState, Villager, AgentActivity, VillageStats, ToolEventRecord
      activity-map.ts     # toolToActivity() — PURE, data-driven
    ui/
      main/ { index.html  main.tsx  App.tsx }
      settings/ { index.html  main.tsx  App.tsx }
      scene/
        assets-manifest.ts # procedural sprite factories (CC0-swap seam)
        stations.ts        # station layout + activity→station map
        villager.ts        # Villager sprite container + walk/animate
        world-renderer.ts  # WorldState → scene reconcile (by sessionId)
        engine.ts          # Pixi.Application bootstrap + ticker
      stats/ StatsPanel.tsx
    i18n/ { en.json  zh-CN.json }
  __tests__/  (vitest: activity-map, world, events-store, stats)
```

---

## Task 1: Buildable extension skeleton

**Files:** create the whole `extensions/agent-village/` config + stub entries (mirroring `extensions/tool-meter/`), so the package builds before any feature code.

- [ ] **Step 1: Copy tool-meter's build scaffolding**

Create `extensions/agent-village/` with these files, copied from `extensions/tool-meter/` and adjusted:
- `tsconfig.json` — IDENTICAL to tool-meter's.
- `postcss.config.cjs`, `tailwind.config.cjs` — IDENTICAL to tool-meter's.
- `vite.main.config.ts` — IDENTICAL to tool-meter's (lib cjs → dist/main.cjs; external electron/@amiba/node).
- `vite.ui.config.ts` — like tool-meter's BUT add a second rollup input for `settings` (so both `main` and `settings` HTML entries build, mirroring how knowledge-base does two UI entries). Inputs: `main: src/ui/main/index.html`, `settings: src/ui/settings/index.html`.
- `src/shared/hermes-bridge.ts` — IDENTICAL to tool-meter's (typed `window.hermes`).
- `src/shared/i18n.ts` — IDENTICAL to tool-meter's (useT/useTheme reading catalogs + hermes.on).
- `src/shared/tailwind.css` — IDENTICAL to tool-meter's.

- [ ] **Step 2: package.json**

Create `extensions/agent-village/package.json`:

```json
{
  "name": "@amiba/ext-agent-village",
  "version": "0.1.0",
  "private": true,
  "description": "Stardew-Valley-style live agent activity village for amiba.",
  "main": "dist/main.cjs",
  "exports": { ".": { "main": "./dist/main.cjs" }, "./manifest.json": "./manifest.json" },
  "scripts": {
    "build": "rm -rf dist && vite build -c vite.main.config.ts && vite build -c vite.ui.config.ts",
    "dev": "amiba-ext dev",
    "pack": "amiba-ext pack",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@amiba/extension-api": "workspace:*",
    "@amiba/ui": "workspace:*",
    "lucide-react": "^0.460.0",
    "pixi.js": "^8.5.0"
  },
  "peerDependencies": { "electron": "*", "react": "^18.0.0", "react-dom": "^18.0.0" },
  "devDependencies": {
    "@amiba/extension-cli": "workspace:*",
    "@amiba/tailwind-preset": "workspace:*",
    "@types/node": "^20.0.0",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@vitejs/plugin-react": "4.3.3",
    "autoprefixer": "10.4.20",
    "postcss": "8.4.49",
    "tailwindcss": "3.4.15",
    "typescript": "5.6.3",
    "vite": "5.4.10",
    "vitest": "2.1.4"
  }
}
```

- [ ] **Step 3: manifest.json**

```json
{
  "$schema": "../../packages/extension-api/src/manifest.schema.json",
  "id": "io.hermes.agent-village",
  "name": "Agent Village",
  "version": "0.1.0",
  "apiVersion": 1,
  "engines": { "amiba": "^0.1.0" },
  "entries": { "main": "dist/main.cjs" },
  "contributes": {
    "main": {
      "icon": "trees",
      "labels": { "en": "Village", "zh-CN": "智能体村庄" },
      "view": "dist/ui/main/index.html",
      "order": 350
    },
    "settings": {
      "icon": "trees",
      "labels": { "en": "Village", "zh-CN": "智能体村庄" },
      "view": "dist/ui/settings/index.html",
      "order": 350
    }
  },
  "permissions": ["ipc", "storage", "settings", "i18n", "lifecycle.boot"]
}
```

- [ ] **Step 4: Stub entries + i18n so it builds**

Create minimal `src/ui/main/{index.html,main.tsx,App.tsx}` and `src/ui/settings/{index.html,main.tsx,App.tsx}` (copy tool-meter's index.html/main.tsx shape; `App.tsx` a one-line placeholder `export default function App(){return <div/>}`), `src/main/index.ts` (`export const activate = () => {}`), and `src/i18n/{en.json,zh-CN.json}` (`{}` for now).

- [ ] **Step 5: Install + build**

Run: `pnpm install` (repo root; picks up pixi.js + the new workspace package), then `pnpm -F @amiba/ext-agent-village build` and `pnpm -F @amiba/ext-agent-village typecheck`.
Expected: install succeeds (pixi.js fetched), build emits `dist/main.cjs` + `dist/ui/main/index.html` + `dist/ui/settings/index.html`, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add extensions/agent-village
git -c user.name=iHeyTang -c user.email=dehui1012@gmail.com commit -m "feat(ext/agent-village): buildable extension skeleton (manifest, build config, pixi.js dep)"
```

---

## Task 2: Shared types + activity-map (PURE, TDD)

**Files:** `src/shared/types.ts`, `src/shared/activity-map.ts`, test `__tests__/activity-map.test.ts`.

- [ ] **Step 1: Write the failing test** — `extensions/agent-village/__tests__/activity-map.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { toolToActivity } from "../src/shared/activity-map"

describe("toolToActivity", () => {
  it("maps read tools to reading", () => {
    expect(toolToActivity("read_file")).toBe("reading")
    expect(toolToActivity("cat")).toBe("reading")
  })
  it("maps write/edit tools to writing", () => {
    expect(toolToActivity("write_file")).toBe("writing")
    expect(toolToActivity("apply_patch")).toBe("writing")
  })
  it("maps shell/exec tools to running", () => {
    expect(toolToActivity("shell")).toBe("running")
    expect(toolToActivity("bash")).toBe("running")
  })
  it("maps search tools to searching", () => {
    expect(toolToActivity("grep")).toBe("searching")
    expect(toolToActivity("glob")).toBe("searching")
  })
  it("maps web tools to browsing", () => {
    expect(toolToActivity("web_fetch")).toBe("browsing")
  })
  it("maps task/agent tools to spawning", () => {
    expect(toolToActivity("task")).toBe("spawning")
    expect(toolToActivity("dispatch_agent")).toBe("spawning")
  })
  it("is case-insensitive", () => {
    expect(toolToActivity("READ_FILE")).toBe("reading")
  })
  it("falls back to running for unknown tools (with bubble carrying the real name)", () => {
    expect(toolToActivity("some_unknown_tool")).toBe("thinking")
  })
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm -F @amiba/ext-agent-village exec vitest run __tests__/activity-map.test.ts`.

- [ ] **Step 3: Implement `src/shared/types.ts`:**

```ts
export type AgentActivity =
  | "idle" | "thinking" | "reading" | "writing"
  | "running" | "searching" | "browsing" | "spawning"
  | "done" | "error"

export interface Villager {
  sessionId: string
  parentSessionId?: string
  role: "main" | "sub"
  title?: string
  status: "thinking" | "working" | "waiting" | "done" | "error"
  activity: AgentActivity
  currentTool?: string
  emoji?: string
  toolCalls: number
  costUsd?: number
  tokens?: number
  lastActiveAt?: number
  endedAt?: number
}

export interface WorldState {
  generatedAt: number
  villagers: Villager[]
  overflow: number // count of villagers folded out by the cap
}

export interface ToolEventRecord {
  ts: number
  sessionId?: string
  tool: string
  toolCallId: string
  durationMs?: number
  emoji?: string
  label?: string
}

export interface DayBucket { day: string; calls: number; costUsd: number }
export interface ToolShare { tool: string; calls: number }
export interface HeatmapCell { day: string; value: number; level: 0 | 1 | 2 | 3 | 4 }

export interface VillageStats {
  generatedAt: number
  today: { activeAgents: number; calls: number; costUsd: number }
  trend: DayBucket[]
  heatmap: HeatmapCell[]
  byTool: ToolShare[]
  recentLog: ToolEventRecord[]
}
```

- [ ] **Step 4: Implement `src/shared/activity-map.ts`:**

```ts
import type { AgentActivity } from "./types"

interface Rule { activity: AgentActivity; patterns: RegExp[] }

// Order matters: first match wins.
const RULES: Rule[] = [
  { activity: "spawning", patterns: [/task/, /agent/, /spawn/, /dispatch/, /subagent/, /delegate/] },
  { activity: "writing", patterns: [/write/, /edit/, /create/, /apply_patch/, /str_replace/, /mkdir/, /insert/] },
  { activity: "reading", patterns: [/read/, /\bcat\b/, /view/, /open/, /head/, /tail/] },
  { activity: "running", patterns: [/shell/, /bash/, /exec/, /\brun\b/, /command/, /terminal/, /npm/, /pnpm/, /git/, /test/] },
  { activity: "searching", patterns: [/search/, /grep/, /glob/, /find/, /ripgrep/, /\brg\b/, /\bls\b/, /list/] },
  { activity: "browsing", patterns: [/web/, /fetch/, /http/, /browse/, /\burl\b/, /navigate/, /curl/, /request/] },
]

/** Map a raw tool name to an animation activity. Unknown → "thinking" (the
 * head bubble still shows the real tool name, so info isn't lost). */
export function toolToActivity(tool: string | undefined): AgentActivity {
  if (!tool) return "thinking"
  const t = tool.toLowerCase()
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(t))) return rule.activity
  }
  return "thinking"
}
```

- [ ] **Step 5: Run → PASS.** Same vitest command. Then `pnpm -F @amiba/ext-agent-village typecheck` (exit 0).

- [ ] **Step 6: Commit** — `feat(ext/agent-village): WorldState/VillageStats types + tool→activity map (tested)`.

---

## Task 3: WorldState synthesis (PURE, TDD)

**Files:** `src/main/world.ts`, test `__tests__/world.test.ts`. Depends on Task 2 types + `toolToActivity`.

- [ ] **Step 1: Failing test** — `__tests__/world.test.ts`. The function under test:
`buildWorldState(input: { mainSessionId?: string; live?: { tool?: string; emoji?: string }; sessions: SessionInfo[]; now: number; cap?: number }): WorldState` where `SessionInfo` is the subset of `HermesSessionInfo` used (`id, parent_session_id, title, last_active, ended_at, end_reason, tool_call_count, estimated_cost_usd, actual_cost_usd, input_tokens, output_tokens`).

```ts
import { describe, expect, it } from "vitest"
import { buildWorldState } from "../src/main/world"

const NOW = 1_000_000
const recent = NOW - 5_000      // within the 30s "working" window
const stale = NOW - 60_000      // older than the window → waiting

describe("buildWorldState", () => {
  it("marks the active desktop session as the main villager driven by live tool", () => {
    const w = buildWorldState({
      mainSessionId: "s1", live: { tool: "read_file", emoji: "📖" },
      sessions: [{ id: "s1", last_active: recent, tool_call_count: 3, estimated_cost_usd: 0.5 }],
      now: NOW,
    })
    const main = w.villagers.find((v) => v.sessionId === "s1")!
    expect(main.role).toBe("main")
    expect(main.activity).toBe("reading")
    expect(main.emoji).toBe("📖")
    expect(main.toolCalls).toBe(3)
  })

  it("groups child sessions as sub villagers", () => {
    const w = buildWorldState({
      mainSessionId: "s1", sessions: [
        { id: "s1", last_active: recent },
        { id: "c1", parent_session_id: "s1", last_active: recent, tool_call_count: 1 },
      ], now: NOW,
    })
    expect(w.villagers.find((v) => v.sessionId === "c1")!.role).toBe("sub")
    expect(w.villagers.find((v) => v.sessionId === "c1")!.parentSessionId).toBe("s1")
  })

  it("infers done/error/working/waiting from session fields", () => {
    const w = buildWorldState({
      mainSessionId: "m", sessions: [
        { id: "m", last_active: recent },
        { id: "done1", parent_session_id: "m", ended_at: NOW - 100, end_reason: "completed" },
        { id: "err1", parent_session_id: "m", ended_at: NOW - 100, end_reason: "error" },
        { id: "wait1", parent_session_id: "m", last_active: stale },
      ], now: NOW,
    })
    const by = (id: string) => w.villagers.find((v) => v.sessionId === id)!
    expect(by("done1").status).toBe("done");  expect(by("done1").activity).toBe("done")
    expect(by("err1").status).toBe("error");   expect(by("err1").activity).toBe("error")
    expect(by("wait1").status).toBe("waiting")
  })

  it("folds villagers beyond the cap and reports the overflow count", () => {
    const sessions = [{ id: "m", last_active: recent }]
    for (let i = 0; i < 12; i++) sessions.push({ id: `c${i}`, parent_session_id: "m", last_active: recent - i })
    const w = buildWorldState({ mainSessionId: "m", sessions, now: NOW, cap: 8 })
    expect(w.villagers.length).toBe(8)
    expect(w.overflow).toBe(5) // 1 main + 12 children = 13; keep 8; fold 5
    expect(w.villagers.find((v) => v.role === "main")).toBeTruthy() // main always kept
  })

  it("returns an empty village when there are no sessions", () => {
    const w = buildWorldState({ sessions: [], now: NOW })
    expect(w.villagers).toEqual([]); expect(w.overflow).toBe(0)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/main/world.ts`** — a pure function:
  - Filter sessions to the main session + its direct children (`parent_session_id === mainSessionId`). If `mainSessionId` is undefined, village is empty.
  - Map each to `Villager`: `role` main/sub; `status` via `ended_at` → done (or error if `end_reason` matches `/error|abort|fail/i`), else `last_active >= now - 30_000` → working, else waiting; main's `activity` from `toolToActivity(live.tool)` (or "idle" if no live tool), sub's `activity` from status (done→done, error→error, working→running, waiting→idle); `currentTool`/`emoji` from `live` for main; `toolCalls` from `tool_call_count ?? 0`; `costUsd` from `actual_cost_usd ?? estimated_cost_usd`; `tokens` from `input+output`; `lastActiveAt`/`endedAt`.
  - Sort: main first, then by `lastActiveAt` desc. Keep `cap` (default 8), set `overflow = max(0, total - kept)`.

- [ ] **Step 4: Run → PASS.** Typecheck.

- [ ] **Step 5: Commit** — `feat(ext/agent-village): buildWorldState synthesis from live + listSessions (tested)`.

---

## Task 4: Events store + aggregation (PURE core, TDD)

**Files:** `src/main/events-store.ts`, test `__tests__/events-store.test.ts`.

- [ ] **Step 1: Failing test** for the PURE aggregation helpers (storage IO is thin and not unit-tested; the math is):
`dayKey(ts): string` (UTC `YYYY-MM-DD`), `aggregateByTool(records): ToolShare[]` (desc by calls), `recentLog(records, limit): ToolEventRecord[]` (newest first).

```ts
import { describe, expect, it } from "vitest"
import { dayKey, aggregateByTool, recentLog } from "../src/main/events-store"

describe("events-store aggregation", () => {
  it("dayKey formats UTC YYYY-MM-DD", () => {
    expect(dayKey(Date.UTC(2026, 5, 5, 23, 0, 0))).toBe("2026-06-05")
  })
  it("aggregateByTool counts and sorts desc", () => {
    const recs = [
      { ts: 1, tool: "read", toolCallId: "a" },
      { ts: 2, tool: "shell", toolCallId: "b" },
      { ts: 3, tool: "read", toolCallId: "c" },
    ]
    expect(aggregateByTool(recs)).toEqual([{ tool: "read", calls: 2 }, { tool: "shell", calls: 1 }])
  })
  it("recentLog returns newest first, limited", () => {
    const recs = [
      { ts: 1, tool: "a", toolCallId: "1" },
      { ts: 2, tool: "b", toolCallId: "2" },
      { ts: 3, tool: "c", toolCallId: "3" },
    ]
    expect(recentLog(recs, 2).map((r) => r.tool)).toEqual(["c", "b"])
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/main/events-store.ts`:** the 3 pure helpers above + storage-backed `appendEvent(host, rec)` (read `events.<dayKey>` array, push, write; uses `host.storage`) and `readRecentDays(host, n): Promise<ToolEventRecord[]>` (concat last n day buckets). Pure helpers exported for tests; IO functions thin wrappers.

- [ ] **Step 4: Run → PASS.** Typecheck.

- [ ] **Step 5: Commit** — `feat(ext/agent-village): event day-buckets + by-tool/recent aggregation (tested)`.

---

## Task 5: VillageStats synthesis (PURE core, TDD)

**Files:** `src/main/stats.ts`, test `__tests__/stats.test.ts`.

- [ ] **Step 1: Failing test** for `buildStatsFromSessions(sessions, now)` → `{ today, trend, heatmap }` (calls = sum tool_call_count per day bucket by `last_active`/`started_at`; cost = sum cost; heatmap level via quantiles) and `quantileLevel(values)`. Cover: today active-agents count (sessions active within today), trend buckets summed, heatmap level 0 for empty days.

```ts
import { describe, expect, it } from "vitest"
import { buildStatsFromSessions } from "../src/main/stats"

const DAY = 86_400_000
const NOW = Date.UTC(2026, 5, 5, 12)

describe("buildStatsFromSessions", () => {
  it("sums today's calls and cost and counts active agents", () => {
    const s = buildStatsFromSessions([
      { id: "a", last_active: NOW, tool_call_count: 3, actual_cost_usd: 0.2 },
      { id: "b", last_active: NOW - 1000, tool_call_count: 2, estimated_cost_usd: 0.1 },
    ], NOW)
    expect(s.today.calls).toBe(5)
    expect(s.today.costUsd).toBeCloseTo(0.3)
    expect(s.today.activeAgents).toBe(2)
  })
  it("buckets trend by day", () => {
    const s = buildStatsFromSessions([
      { id: "a", last_active: NOW, tool_call_count: 2 },
      { id: "b", last_active: NOW - DAY, tool_call_count: 4 },
    ], NOW)
    const today = s.trend.find((d) => d.day === "2026-06-05")!
    const yest = s.trend.find((d) => d.day === "2026-06-04")!
    expect(today.calls).toBe(2); expect(yest.calls).toBe(4)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/main/stats.ts`:** `buildStatsFromSessions` (trend = last 14 day buckets by `last_active ?? started_at`; today = the current UTC day bucket + active-agents = sessions with `last_active` in today and no `ended_at`; heatmap = last 12 weeks of daily call counts with quantile levels) + `quantileLevel`. (by-tool + recentLog come from the events store, merged in `main/index.ts`.)

- [ ] **Step 4: Run → PASS.** Typecheck.

- [ ] **Step 5: Commit** — `feat(ext/agent-village): VillageStats trend/heatmap/today from listSessions (tested)`.

---

## Task 6: Main runner — subscribe, poll-synthesize, expose IPC

**Files:** `src/main/index.ts`.

- [ ] **Step 1: Implement `activate`:**
  - Keep in-memory `liveMain: { sessionId?: string; tool?: string; emoji?: string; startedAt?: number }`.
  - `host.chat.onEvent("tool.started", e => { liveMain = { sessionId: e.sessionId, tool: e.tool, emoji: e.emoji, startedAt: e.startedAt }; void appendEvent(host, {...}) })`.
  - `host.chat.onEvent("tool.completed", e => { if (liveMain.tool && liveMain.sessionId===e.sessionId) liveMain.tool = undefined; void appendEvent(host, {... durationMs}) })`.
  - `host.chat.onEvent("run.completed", e => { liveMain.sessionId = e.sessionId })` (track the active session id).
  - `host.ipc.expose("village.world", async () => { const sessions = await host.hermes.listSessions({ limit: 200 }); return buildWorldState({ mainSessionId: liveMain.sessionId, live: liveMain, sessions, now: Date.now(), cap: await host.settings.get("ui.villagerCap", 8) }) })`.
  - `host.ipc.expose("village.stats", async () => { const sessions = await host.hermes.listSessions({ limit: 200 }); const base = buildStatsFromSessions(sessions, Date.now()); const events = await readRecentDays(host, 14); return { ...base, generatedAt: Date.now(), byTool: aggregateByTool(events), recentLog: recentLog(events, 30) } })`.
  - Guard the active-session id: if `liveMain.sessionId` is still undefined (no event yet), fall back to the most-recently-active top-level session from `listSessions` so the village isn't empty on first open.

- [ ] **Step 2: Typecheck + build** — `pnpm -F @amiba/ext-agent-village typecheck` (exit 0); `pnpm -F @amiba/ext-agent-village build` (main.cjs emitted). Run the suite: `pnpm -F @amiba/ext-agent-village test` (Tasks 2-5 tests still pass).

- [ ] **Step 3: Commit** — `feat(ext/agent-village): main runner wires events + listSessions to village.world/stats IPC`.

---

## Task 7: PixiJS scene — engine, stations, villager, renderer (placeholder art)

**Files:** `src/ui/scene/{assets-manifest.ts, stations.ts, villager.ts, world-renderer.ts, engine.ts}`. No unit tests (visual); verified by build + typecheck. Procedural `Graphics` art only — zero external assets.

- [ ] **Step 1: `assets-manifest.ts`** — the CC0-swap seam. Export `drawVillager(g: Graphics, opts: { role, activity, color })` and `drawStation(g, kind)` that paint simple pixel shapes with `Graphics`. Header comment: "PLACEHOLDER ART — replace these procedural painters with CC0 sprite textures (see spec §9). The rest of the scene consumes only this module for visuals."

- [ ] **Step 2: `stations.ts`** — fixed station coordinates (a small grid) + `stationFor(activity): {x,y,label,emoji}` (reading→📚, writing→✍️, running→🔨, searching→🎣, browsing→🔮, spawning→✨, thinking/idle→🟩 center, done→🔥, error→center). Pure data + a lookup.

- [ ] **Step 3: `villager.ts`** — a `Villager` class wrapping a Pixi `Container` (body via `drawVillager` + a head bubble `Text` for emoji/tool + a nameplate `Text`). Methods: `setTarget({x,y})`, `update(dt)` (lerp position toward target), `setActivity(activity, emoji, label)`.

- [ ] **Step 4: `world-renderer.ts`** — `class WorldRenderer { constructor(stage) ; apply(world: WorldState) }`. Reconciles by `sessionId`: create new villager sprites, update target station (via `stationFor(v.activity)`) + bubble, remove gone ones; renders an overflow "+N" chip when `world.overflow>0`; draws station markers once.

- [ ] **Step 5: `engine.ts`** — `async function mountScene(canvasParent: HTMLElement): Promise<{ apply(world): void; destroy(): void }>`: create `new Application()`, `await app.init({ background, antialias:false, resolution })`, append canvas, instantiate `WorldRenderer`, drive `app.ticker` to call each villager's `update(dt)`. Pixel-art crisp: set `roundPixels` / nearest scaling.

- [ ] **Step 6: Typecheck + build** — both exit 0 (this is the first real pixi.js usage; fix any v8 API mismatch, e.g. `Application.init` is async in v8, `Graphics` uses the v8 chainable API `.rect().fill()`).

- [ ] **Step 7: Commit** — `feat(ext/agent-village): PixiJS scene — stations, villagers, renderer (placeholder art behind asset seam)`.

---

## Task 8: Stats panel (DOM, @amiba/ui)

**Files:** `src/ui/stats/StatsPanel.tsx`. Mirror `extensions/tool-meter/src/ui/main/App.tsx`'s vocabulary (Section/HeroCard/SparkBar/ToolRow + `Heatmap` from `@amiba/ui`).

- [ ] **Step 1: Implement `StatsPanel({ stats }: { stats: VillageStats | null })`** — Hero trio (active agents / today calls / today cost), an in-scene roster is separate (Task 9); here: trend SparkBars, by-tool ToolRows, `<Heatmap cells={stats.heatmap} .../>`, and a "village log" list of `recentLog` (`{emoji} {tool} {durationMs}ms`). Label the by-tool section "desktop-session tools" per spec §6 caveat. Use `useT`/`useTheme` from shared.

- [ ] **Step 2: Typecheck + build** (exit 0). Confirm `@amiba/ui` exports `Heatmap`, `ScrollArea`, `Button`, `cn` resolve.

- [ ] **Step 3: Commit** — `feat(ext/agent-village): pixel-styled stats panel (reuses @amiba/ui Heatmap)`.

---

## Task 9: Compose App (scene + stats), polling loop, settings page, i18n

**Files:** `src/ui/main/App.tsx`, `src/ui/settings/App.tsx`, `src/i18n/{en.json,zh-CN.json}`, `src/ui/main/main.tsx` + `index.html` (finalize).

- [ ] **Step 1: `src/ui/main/App.tsx`** — layout: top = scene (a `<div ref>` that `mountScene` attaches Pixi canvas to in `useEffect`), bottom (or a ChipSwitcher toggle) = `<StatsPanel>`. Poll loop: `useEffect` `setInterval(async () => { if (document.hidden) return; const [world, stats] = await Promise.all([hermes.ipc.invoke("village.world"), hermes.ipc.invoke("village.stats")]); sceneHandle.apply(world); setStats(stats) }, 800)`; clear on unmount; call `scene.destroy()` on unmount. `useTheme()` at root.

- [ ] **Step 2: `src/ui/settings/App.tsx`** — minimal: animation speed (slow/normal/fast), show-bubbles toggle, stats weeks, villager cap — persisted via `hermes.settings`. (Mirror tool-meter's settings pattern; keep it small.)

- [ ] **Step 3: i18n** — fill `en.json` + `zh-CN.json` with the labels used (title, hero labels, section titles, settings labels, activity names). Keys parallel in both.

- [ ] **Step 4: Full build + typecheck + tests** — `pnpm -F @amiba/ext-agent-village build && pnpm -F @amiba/ext-agent-village typecheck && pnpm -F @amiba/ext-agent-village test`. All green; `dist/ui/main/index.html` + `dist/ui/settings/index.html` emitted.

- [ ] **Step 5: Commit** — `feat(ext/agent-village): compose scene+stats, polling loop, settings page, i18n`.

---

## Task 10: Assets credits + finalize

**Files:** `extensions/agent-village/assets/CREDITS.md`.

- [ ] **Step 1:** Create `assets/CREDITS.md` documenting: v1 uses procedural placeholder art (no third-party assets); when CC0 sprite packs are added, log each here with source + license (CC0/Kenney etc.); star­dew本体素材 forbidden. (No binary assets shipped in v1.)

- [ ] **Step 2: Whole-extension verify** — from repo root: `pnpm -F @amiba/ext-agent-village test && pnpm -F @amiba/ext-agent-village typecheck && pnpm -F @amiba/ext-agent-village build`. Also confirm the monorepo still builds the other extensions: `pnpm -F @amiba/extension-host test` (unaffected). `git status` clean (dist ignored).

- [ ] **Step 3: Commit** — `docs(ext/agent-village): asset credits + placeholder-art note`.

---

## Final Verification & Self-Review

- [ ] **Build/test gate:** `pnpm -F @amiba/ext-agent-village test` (all unit suites pass), `typecheck` exit 0, `build` emits main.cjs + both UI entries.
- [ ] **Pixi v8 sanity:** scene compiles against pixi.js ^8 (Application.init async, Graphics chainable API).
- [ ] **Honest status (for the report):** logic unit-tested + builds green; **art is placeholder**, **visual/runtime verification pending the user running the desktop app** (`pnpm dev:desktop`, open the Village activity item).

**Self-review (done while writing):**
- Spec coverage: §2.1 manifest (Task 1) · §3 data-source split (Task 6 wires live events + listSessions) · §4 WorldState model (Task 2/3) · §5 scene/stations/villager/state-machine (Task 7) · §6 stats panel + caveat label (Task 8) · §7 storage + settings (Task 4/9) · §8 file structure (all) · §9 build/pixi/credits (Task 1/10). ✓
- Types consistent: `WorldState`/`Villager`/`VillageStats`/`ToolEventRecord` defined once in `shared/types.ts` (Task 2) and consumed identically in world.ts/stats.ts/renderer/StatsPanel. `toolToActivity` signature stable. IPC channel names `village.world`/`village.stats` consistent between Task 6 (expose) and Task 9 (invoke).
- Placeholder scan: pure-logic tasks have full code; scene/UI tasks are concrete (files + responsibilities + the exact pixi v8 gotchas) — acceptable since they're visual and verified by build, not unit tests.
