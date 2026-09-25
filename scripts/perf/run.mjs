#!/usr/bin/env node
/**
 * Amiba performance baseline runner — Tier A (pure Node, no GUI).
 *
 * Measures the conversation rendering hot paths against REAL session logs
 * (zstd-JSONL from the DSH runtime), so every optimization round has a
 * before/after number instead of vibes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/perf/run.mjs
 *   node --experimental-strip-types scripts/perf/run.mjs --sessions-dir "<dir>"
 *
 * Options:
 *   --sessions-dir DIR   session workspace dir (default: the live Amiba app's
 *                        hermes-x workspace session folder)
 *   --top N              decode the N largest sessions (default 3)
 *   --out FILE           results JSON path (default scripts/perf/results/latest.json)
 *
 * Outputs a human table to stdout and writes a JSON metrics report.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// --- CLI ------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const sessionsDir =
  flag("--sessions-dir", null) ??
  path.join(
    os.homedir(),
    "Library/Application Support/@amiba/desktop/dsh/home/sessions",
  );
const top = Number(flag("--top", "3"));
const outFile =
  flag("--out", null) ??
  path.join(REPO_ROOT, "scripts/perf/results/latest.json");

// --- Real-code imports ------------------------------------------------------
// windowTurns comes straight from packages/ui (the real implementation). The
// streamdown lexer is measured the same way the app uses it.
let windowTurns, MESSAGE_TURN_WINDOW, MESSAGE_DOM_CAP;
try {
  const t = await import(
    `${REPO_ROOT}/packages/ui/src/chat/turn-window.ts`
  );
  windowTurns = t.windowTurns;
  MESSAGE_TURN_WINDOW = t.MESSAGE_TURN_WINDOW;
  MESSAGE_DOM_CAP = t.MESSAGE_DOM_CAP;
} catch (error) {
  console.error(
    "[perf] could not import packages/ui/src/chat/turn-window.ts — run with `node --experimental-strip-types`",
    error.message,
  );
  process.exit(2);
}
const streamdownRoot = path.join(
  REPO_ROOT,
  "node_modules/.pnpm",
  fs
    .readdirSync(path.join(REPO_ROOT, "node_modules/.pnpm"))
    .find((d) => d.startsWith("streamdown@")),
  "node_modules/streamdown",
);
const { parseMarkdownIntoBlocks } = await import(
  `${streamdownRoot}/dist/index.js`
);
const workspaceReview = await import(
  `${REPO_ROOT}/packages/ui/src/chat/workspace-review.ts`
);

// --- Utilities --------------------------------------------------------------

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function bench(fn, samples = 40) {
  fn(); // warmup
  const runs = [];
  for (let i = 0; i < samples; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return median(runs);
}

/** Decompress a session.v3.jsonl.zstd (concatenated zstd frames). */
function decodeSessionLog(file) {
  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const parts = [];
  let idx = 0;
  while (idx < buf.length) {
    const m = buf.indexOf(magic, idx);
    if (m < 0) break;
    const next = buf.indexOf(magic, m + 4);
    const end = next < 0 ? buf.length : next;
    try {
      parts.push(zstdDecompressSync(buf.subarray(m, end)));
    } catch {
      /* truncated trailing frame — ignore */
    }
    idx = Math.max(m + 4, end);
  }
  return Buffer.concat(parts);
}

/** Build a conversation row model mirroring the UI's turn grouping. */
function buildTurnModel(decodedText) {
  let turns = [];
  let cur = null;
  let maxMsgBytes = 0;
  let rows = 0;
  const kinds = {};
  for (const line of decodedText.split("\n")) {
    if (!line) continue;
    rows += 1;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const kind = entry.type || "";
    kinds[kind] = (kinds[kind] || 0) + 1;
    if (line.length > maxMsgBytes) maxMsgBytes = line.length;
    if (kind === "user/message") {
      if (cur) turns.push(cur);
      cur = { user: 1, replies: 0 };
    } else if (kind === "turn/start") {
      if (cur) {
        turns.push(cur);
        cur = null;
      }
    } else if (
      kind === "assistant/message" ||
      kind === "tool/call" ||
      kind === "tool/result"
    ) {
      if (cur) cur.replies += 1;
    }
  }
  if (cur) turns.push(cur);
  if (turns.length === 0) turns = [{ user: 0, replies: rows }];
  return { turns, rows, kinds, maxMsgBytes };
}

const countTurnMessages = (t) => (t.user ? 1 : 0) + t.replies;

function windowMetrics(turns, limit, cap) {
  const w = windowTurns(turns, limit, {
    maxMessages: cap,
    countMessages: countTurnMessages,
  });
  const mounted = w.visible.reduce((s, t) => s + countTurnMessages(t), 0);
  return { visibleTurns: w.visible.length, hiddenTurns: w.hidden, mounted };
}

// --- Run -------------------------------------------------------------------

if (!fs.existsSync(sessionsDir)) {
  console.error(`[perf] sessions dir not found: ${sessionsDir}`);
  process.exit(1);
}

const workspaceDirs = fs
  .readdirSync(sessionsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(sessionsDir, d.name));

const sessions = [];
for (const workspace of workspaceDirs) {
  const workspaceName = path.basename(workspace);
  for (const dir of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const log = path.join(workspace, dir.name, "session.v3.jsonl.zstd");
    if (!fs.existsSync(log)) continue;
    sessions.push({ workspace: workspaceName, id: dir.name, log, size: fs.statSync(log).size });
  }
}
sessions.sort((a, b) => b.size - a.size);
const decoded = sessions.slice(0, top).map((s) => {
  const text = decodeSessionLog(s.log).toString("utf8");
  const model = buildTurnModel(text);
  return { session: s.id, workspace: s.workspace, fileBytes: s.size, decodedBytes: text.length, ...model };
});

// Streaming micro-benchmarks (synthetic, representative of a long reply).
const md10k = Array.from({ length: 60 }, (_, i) =>
  `## 章节 ${i}\n\n正文 **加粗** 与 \`inline\` 与[链接](https://example.com)。\n\n\`\`\`json\n{"k":"v${i}"}\n\`\`\`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`,
).join("");
const md40k = md10k.repeat(4);
const parse10k = bench(() => parseMarkdownIntoBlocks(md10k));
const parse40k = bench(() => parseMarkdownIntoBlocks(md40k));

// Synthetic grouped-message bench matching the app derivation shape.
const messages = decoded[0]?.turns.flatMap((t) => [
  ...(t.user ? [{ uiId: `u-${Math.random()}`, role: "user", content: "q", runtimeTurn: 0 }] : []),
  ...Array.from({ length: t.replies }, (_, i) => ({
    uiId: `a-${i}-${Math.random()}`,
    role: "assistant",
    content: "r",
    runtimeTurn: 0,
    toolProgress: [],
  })),
]) ?? [];
const groupBench = bench(() => {
  const turns = [];
  let cur = null;
  for (const m of messages) {
    if (m.role === "user") {
      cur = { user: m, replies: [], userOrdinal: 0 };
      turns.push(cur);
    } else if (cur) cur.replies.push(m);
  }
  return turns;
});

function benchmarkWorkspaceReview() {
  // Turn-level review derivation, as MessageTurns runs it per settled turn
  // per frame. Real edit results carry tens of KB of patch text; the diff
  // scan trims/copies the whole string per candidate key.
  const patch = (i) =>
    `*** Begin Patch\n*** Update File: src/file-${i}.ts\n@@ -1,2 +1,2 @@\n context\n+added line ${i}\n-removed ${i}\n${"content-line\n".repeat(900)}`;
  const freshEvents = () =>
    Array.from({ length: 16 }, (_, i) => ({
      toolCallId: `edit-${i}`,
      tool: i % 3 === 0 ? "write" : "edit",
      status: "completed",
      result: {
        patch: patch(i),
      },
    }));
  const cold = bench(() =>
    workspaceReview.workspaceReviewResourceFromEvents(freshEvents(), "turn:bench"),
  );
  // Steady state AFTER the fix: settled messages reuse the SAME event refs
  // each frame, so the per-event derivations are cached (WeakMap).
  const settled = freshEvents();
  const warm = bench(() =>
    workspaceReview.workspaceReviewResourceFromEvents(settled, "turn:bench"),
  );
  return {
    reviewScanColdMsPerFrame: { medianMs: cold, note: "pre-cache per-frame scan for ~16 edit/write events (fresh refs)" },
    reviewScanWarmMsPerFrame: { medianMs: warm, note: "post-cache steady state, same event refs" },
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  tool: "node --experimental-strip-types scripts/perf/run.mjs",
  sessionsDir,
  messageModel: "rows ≈ user prompts + assistant messages + tool records",
  sessions: decoded.map((s) => ({
    id: s.session,
    workspace: s.workspace,
    fileBytes: s.fileBytes,
    decodedBytes: s.decodedBytes,
    lines: s.rows,
    maxLineBytes: s.maxMsgBytes,
    kinds: s.kinds,
    turnsCount: s.turns.length,
    totalTurnRows: s.turns.reduce((sum, t) => sum + countTurnMessages(t), 0),
    windowOld: windowMetrics(s.turns, MESSAGE_TURN_WINDOW, Number.POSITIVE_INFINITY),
    windowNew: windowMetrics(s.turns, MESSAGE_TURN_WINDOW, MESSAGE_DOM_CAP),
    windowNewExpand1: windowMetrics(s.turns, MESSAGE_TURN_WINDOW * 2, MESSAGE_DOM_CAP * 2),
  })),
  benchmarks: {
    streamdownParseMs10k: { medianMs: parse10k },
    streamdownParseMs40k: { medianMs: parse40k },
    groupingMsPerRun: { medianMs: groupBench },
    flushArithmetic: {
      // before: chunk + verbose = 2 commits per frame @ 60fps
      beforeCommitsPerSec: 120,
      beforeParseMsPerSec40k: parse40k * 120,
      // after: 1 commit per 2 frames @ 60fps => ~30/s
      afterCommitsPerSec: 30,
      afterParseMsPerSec40k: parse40k * 30,
    },
    workspaceReview: benchmarkWorkspaceReview(),
  },
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

// --- Human table ------------------------------------------------------------

console.log("Amiba performance baseline (Tier A)");
console.log("=".repeat(78));
for (const s of report.sessions) {
  console.log(`\nSession ${s.id} (${s.workspace})`);
  console.log(
    `  decoded ${(s.decodedBytes / 1e6).toFixed(2)} MB · ${s.lines} lines · max line ${(s.maxLineBytes / 1024).toFixed(1)} KB`,
  );
  const kinds = Object.entries(s.kinds)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, n]) => `${k}=${n}`)
    .join("  ");
  console.log(`  kinds: ${kinds}`);
  console.log(
    `  window: OLD(turn-only) mounted=${s.windowOld.mounted} → NEW(cap ${MESSAGE_DOM_CAP}) mounted=${s.windowNew.mounted} (hidden ${s.windowNew.hiddenTurns}); +1 expansion=${s.windowNewExpand1.mounted}`,
  );
}
console.log("\nMicro-benchmarks (median ms/run):");
console.log(
  `  streamdown parse @10KB: ${report.benchmarks.streamdownParseMs10k.medianMs.toFixed(3)} ms`,
);
console.log(
  `  streamdown parse @40KB: ${report.benchmarks.streamdownParseMs40k.medianMs.toFixed(3)} ms`,
);
console.log(
  `  message grouping/run:  ${report.benchmarks.groupingMsPerRun.medianMs.toFixed(4)} ms`,
);
const f = report.benchmarks.flushArithmetic;
console.log(
  `  flush: before ${f.beforeCommitsPerSec}/s (${f.beforeParseMsPerSec40k.toFixed(0)} ms/s parsing @40KB) → after ${f.afterCommitsPerSec}/s (${f.afterParseMsPerSec40k.toFixed(0)} ms/s)`,
);
const rv = report.benchmarks.workspaceReview;
console.log(
  `  workspace review (16 edit/write events, ~44KB patches): cold ${rv.reviewScanColdMsPerFrame.medianMs.toFixed(3)} ms/frame → warm(cached) ${rv.reviewScanWarmMsPerFrame.medianMs.toFixed(4)} ms/frame`,
);
console.log(`\nWrote ${outFile}`);