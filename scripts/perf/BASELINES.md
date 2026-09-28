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
| identical-props memo check (median/max; not typing) | 0.010 / 0.40 ms |
| repeated streaming props (median/max; not changing frames) | 0.011 / 0.21 ms |
| first full mount (jsdom) | ~165 ms (jsdom only; windowed) |
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
## Real Electron typing (2026-09-27)

`render.mjs`'s legacy "keystroke" measurement only repeats identical props on
MessageTurns in jsdom. It does not mount or type in the composer, perform native
layout/paint, or establish input latency. Its streaming loop also repeats an
already-committed props object. Neither near-zero number rules out UI stalls.
Do not extrapolate jsdom mount times into native-browser timings.

To measure the current **visible** dev window with its actual long history:

```sh
REMOTE_DEBUGGING_PORT=19376 pnpm dev:desktop
# Open the affected existing conversation. Do not type/switch sessions during sampling.
node scripts/perf/typing-browser.mjs --run --port 19376 --out /tmp/typing.json
```

This opt-in probe appends 50 actual key events without submitting, restores the
previous Lexical state, and reports DOM size, editor clones, native style/layout
metrics, frame intervals, and CDP key-dispatch round trips. The latter includes
protocol overhead; it is not a direct hardware-key-to-photon measurement. Hidden
windows are rejected. JSON reports contain no draft or conversation contents.

Measured in the user's original dev profile, 28 turns / 370 steps, 24 mounted
turns, 3,389 DOM nodes, settled history (not generating). Before and candidate
reports are in `baselines/typing-{before,candidate}.json`:

| Metric (50 keys) | Before | Candidate: live paragraph geometry |
|---|---:|---:|
| Key dispatch median | 183.24 ms | 4.16 ms |
| Key dispatch P95 | 188.97 ms | 6.23 ms |
| Frame interval P95 | 166.70 ms | 9.20 ms |
| Editor clones | 50 | 0 |
| Layout total | 3,761.85 ms | 6.12 ms |
| Style recalculation total | 4,548.77 ms | 24.50 ms |

AutoGrowPlugin inserted/read/removed a full editor clone on every update. This
forced style/layout work outside React's memo boundaries. CPU sampling located
the hot path in the clone measurement. Disabling blur did not materially help
in the initial isolated diagnostic; disabling auto-grow did. The formal numbers
above use the original dev data, not the initial partial profile copy.

The replacement reads the last normal-flow paragraph's bottom edge plus root
padding and scroll offset. It preserves minimum height, capped scrolling, and
the existing height transition. Browser comparisons with the old clone matched
exactly for empty/short text, wrapping, Chinese text, 20 scrolled paragraphs,
trailing empty paragraphs, and deletion back to one line. Selection-only updates
skip measurement; width changes remeasure wrapping.

Delivery validation: the implementation was merged into local `dev`; its plugin
watcher rebuilt UI shell successfully. The same 31 focused tests and both runtime
TypeScript checks passed there. All six PR checks passed on implementation commit
`f1978796`. The final built-dev foreground sampling was correctly refused while
the Mac was locked; the candidate comparison above must not be relabeled as that
final built-dev run. Repeat the command after unlocking and opening the same
conversation before claiming the final foreground verification is complete.

## Native layout and multiline follow-up (2026-09-28)

The built dev implementation passed 17 native-browser layout cases (two widths,
Chinese/wrapped/multiline/empty content, scroll cap, shrink, and width-only
changes), with the original draft restored. Results: `baselines/composer-native-layout.json`.

The Mac was locked for the follow-up. `typing-browser.mjs --background` now
explicitly enables CDP focus emulation and records the original visibility and
mode. It reports **scheduledFrameIntervalsMs**, not foreground frame intervals.
These runs measure native input handling, style and layout; they do not establish
what was presented on the screen or replace the pending foreground UX check.

```sh
node scripts/perf/typing-browser.mjs --run --background --scenario multiline --samples 30 --out /tmp/multiline.json
# Other input paths: --scenario typing | ime | bulk
```

This broader scenario exposed a second cause: startup CSS retained
`html:has(#amiba-startup) #root *` after removing the overlay. Chromium invalidation
tracking explicitly attributed whole-root invalidations to that selector when
Lexical inserted paragraphs. A three-newline trace recalculated up to 9,721
style elements; replacing the relational gate with a one-time HTML attribute
reduced that maximum to 553 and removed all startup-selector subtree
invalidations. See `baselines/startup-invalidation.json` (aggregates only).

Same actual dev profile, same long conversation and focus-emulation conditions:

| 30 multiline insertions | Auto-grow fix only | + startup attribute gate (A/B) |
|---|---:|---:|
| Input dispatch median | 235.54 ms | 24.24 ms |
| Input dispatch P95 | 265.96 ms | 27.28 ms |
| Native style recalc total | 4,462.39 ms | 255.52 ms |
| Native layout total | 2,046.17 ms | 368.87 ms |

The attribute is present in initial HTML and removed alongside the startup
overlay on both success and failure. Run `node apps/desktop/scripts/smoke-startup-style.mjs`
for Chromium visibility/layout assertions in light/dark and glass/opaque modes,
including explicitly visible child controls and repeated cleanup. This native
smoke uses its own disposable profile and is a correctness test; performance
reports above are from the user's original dev profile.

Remaining investigation: multiline still costs about 24 ms in this A/B run.
The residual trace contains narrower message-action `:has` invalidations. Do
not call the whole experience smooth or change those rules without a separate
measurement. Streaming, history expansion and session switching still need
real-browser scenario coverage.

The compatibility audit also found that the earlier DraftBoundComposer wrapper
omitted its native `draftSource` prop. Two failing regressions demonstrated
literal token text becoming a reference and undo history disappearing on remount.
Forwarding the same source restores both behaviors while preserving the bounded
subscription (33 focused tests now pass). The input probe now keeps a private
recovery copy during a run, rejects conversation changes, and verifies settled
draft restoration before deleting that copy.
