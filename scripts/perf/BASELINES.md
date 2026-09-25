# Amiba performance baselines — Tier A & Tier B

Run from a worktree that has `node_modules` (e.g. the local `dev` checkout):

```sh
# Tier A — pure logic against REAL session logs (zstd-JSONL from the runtime)
node --experimental-strip-types scripts/perf/run.mjs --top 3

# Tier B — real MessageTurns tree rendered in jsdom (keystroke/streaming/mount)
node scripts/perf/render.mjs --turns 200 --samples 40
node scripts/perf/render.mjs --giant 1        # giant live reply scaling
```

## Canonical snapshot (2026-09-25, main @ 3c50fe46)

### Tier A (real sessions: 3 largest, 18MB/11MB/8.6MB logs)
| metric | value |
|---|---|
| session decode (cold) | 71 / 37 / 35 ms |
| streamdown parse @10KB | ~0.5 ms |
| streamdown parse @40KB | ~1.65 ms |
| message grouping | ~0.018 ms/run |

### Tier B — conversation tree, 200 turns (windowed to 24 mounted), ~2.5KB bodies + code fences
| metric | value |
|---|---|
| keystroke re-render (median/max) | 0.010 / 0.40 ms |
| streaming-frame re-render (median/max) | 0.011 / 0.21 ms |
| first full mount (jsdom) | ~165 ms (native ≈ 4-8x lower; windowed, history-independent) |
| giant live reply 20KB..300KB | steady 0.8-1.5 ms/frame (no size scaling) |

## Scan ledger (deep-scan rounds)
1. Sidebar session rows: stable per-row descriptor + memo(SessionRow) — a single
   session update re-renders only that row. ✅ no fix needed.
2. Markdown code blocks: no per-frame highlight in the render path; large bodies
   stay at noise. ✅
3. Workbench file tree / diff views: lazy per-directory load, debounced search,
   capped review expansion (200 lines). ✅
4. First open of large sessions: mount is windowed (≤160 messages), independent
   of history length; ~3ms per 40KB reply in jsdom. ✅
5. Giant live replies: frame cost does not scale with reply size. ✅
6. Command palette / rightbar: thin wrappers, bounded lists. ✅

Each scan shipped the measuring capability that produced its numbers, so future
regressions in any of these surfaces stay visible via `run.mjs` / `render.mjs`.