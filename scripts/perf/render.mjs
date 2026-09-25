#!/usr/bin/env node
/**
 * Amiba performance baseline runner — Tier B (React render, jsdom).
 *
 * Mounts the REAL MessageTurns tree (packages/ui sources, bundled with
 * esbuild) over a synthetic long conversation and times:
 *   - mount: full initial render of the windowed conversation
 *   - keystroke: a re-render with IDENTICAL props — what ChatSurface does
 *     per key press once the draft is decoupled (rounds 1-2). With the
 *     memo boundaries in place this should be ~0 ms regardless of history
 *     length; a regression to unmemoized turns makes it scale with turns.
 *
 * Usage:
 *   node scripts/perf/render.mjs
 *   node scripts/perf/render.mjs --turns 1000 --samples 30
 *
 * Resolves packages/ui sources directly (esbuild), so it measures whatever
 * branch of the repo it is run from.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const TURNS = flag("--turns", 200);
const SAMPLES = flag("--samples", 30);
const GIANT_KB = flag("--giant", 0);

// --- Bundle the real MessageTurns tree with esbuild (no fake imports) -----
const esbuildDir = fs
  .readdirSync(path.join(REPO_ROOT, "node_modules/.pnpm"))
  .filter((d) => d.startsWith("esbuild@"))
  .map((d) => path.join(REPO_ROOT, "node_modules/.pnpm", d, "node_modules/esbuild"))
  .find((d) => fs.existsSync(path.join(d, "package.json")));
if (!esbuildDir) { console.error("[perf tier-b] esbuild not found in pnpm store"); process.exit(2); }
const esbuild = require(esbuildDir);
const entry = `
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document; g.navigator = dom.window.navigator;
g.HTMLElement = dom.window.HTMLElement; g.Node = dom.window.Node; g.Element = dom.window.Element;
g.getComputedStyle = dom.window.getComputedStyle;
if (typeof g.IntersectionObserver !== "function") { g.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} }; }
if (typeof g.ResizeObserver !== "function") { g.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }; }
if (typeof g.requestAnimationFrame !== "function") { g.requestAnimationFrame = (cb) => setTimeout(cb, 0); }

import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { setPlatform } from "@amiba/app-runtime/platform";
const platformStorage = {
  get: async () => ({}), set: async () => {}, remove: async () => {},
  watch: () => () => {},
};
setPlatform({
  kind: "desktop",
  storage: platformStorage,
  shell: { openExternal: async () => {} },
  windowChrome: { topBarHeightPx: 0, leftInsetPx: 0 },
} as Parameters<typeof setPlatform>[0]);
import { MessageTurns } from "./src/chat/bubble/Bubble";

const TURNS = ${TURNS};
if (${GIANT_KB} > 0) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const rootG = createRoot(container);
  const giantProps = (size) => ({
    sessionId: "giant",
    viewStateScope: {},
    messages: [
      { uiId: "u", role: "user", content: "write it all" },
      { uiId: "a", role: "assistant", content: "head\\n" + "w".repeat(size), assistantMessageId: "a-msg", streaming: true },
    ],
  });
  act(() => { rootG.render(createElement(MessageTurns, giantProps(10 * 1024))); });
  const sizes = [20000, 50000, 100000, 200000, 300000];
  const out = [];
  for (const sz of sizes) {
    const t0 = performance.now();
    act(() => { rootG.render(createElement(MessageTurns, giantProps(sz))); });
    out.push(sz + ":" + (performance.now() - t0).toFixed(3));
  }
  console.log(JSON.stringify({ giantLiveReply: true, frameMsPerSize: out }));
  process.exitCode = 0;
}
const BIG = 8;
const messages = [];
for (let i = 0; i < TURNS; i++) {
  const bigReply = i >= TURNS - BIG;
  messages.push({ uiId: \`u\${i}\`, role: "user", content: \`Question number \${i} with some body text\` });
    messages.push({ uiId: \`a\${i}\`, role: "assistant", content: \`Answer number \${i} — longer markdown body with **bold** and \` + "\`code\`".repeat(60) + " para two: " + "words ".repeat(180) + " " + '\`\`\`typescript' + "\\n" + '  const fn0 = (x: number) => x * 0;' + "\\n" + '  const fn1 = (x: number) => x * 1;' + "\\n" + '  const fn2 = (x: number) => x * 2;' + "\\n" + '  const fn3 = (x: number) => x * 3;' + "\\n" + '  const fn4 = (x: number) => x * 4;' + "\\n" + '  const fn5 = (x: number) => x * 5;' + "\\n" + '  const fn6 = (x: number) => x * 6;' + "\\n" + '  const fn7 = (x: number) => x * 7;' + "\\n" + '  const fn8 = (x: number) => x * 8;' + "\\n" + '  const fn9 = (x: number) => x * 9;' + "\\n" + '  const fn10 = (x: number) => x * 10;' + "\\n" + '  const fn11 = (x: number) => x * 11;' + "\\n" + '  const fn12 = (x: number) => x * 12;' + "\\n" + '  const fn13 = (x: number) => x * 13;' + "\\n" + '  const fn14 = (x: number) => x * 14;' + "\\n" + '  const fn15 = (x: number) => x * 15;' + "\\n" + '  const fn16 = (x: number) => x * 16;' + "\\n" + '  const fn17 = (x: number) => x * 17;' + "\\n" + '  const fn18 = (x: number) => x * 18;' + "\\n" + '  const fn19 = (x: number) => x * 19;' + "\\n" + '  const fn20 = (x: number) => x * 20;' + "\\n" + '  const fn21 = (x: number) => x * 21;' + "\\n" + '  const fn22 = (x: number) => x * 22;' + "\\n" + '  const fn23 = (x: number) => x * 23;' + "\\n" + '  const fn24 = (x: number) => x * 24;' + "\\n" + '  const fn25 = (x: number) => x * 25;' + "\\n" + '  const fn26 = (x: number) => x * 26;' + "\\n" + '  const fn27 = (x: number) => x * 27;' + "\\n" + '  const fn28 = (x: number) => x * 28;' + "\\n" + '  const fn29 = (x: number) => x * 29;' + "\\n" + '\`\`\`' + " " + " " + (bigReply ? " words ".repeat(7000) : ""), assistantMessageId: \`a\${i}-msg\` });
}
const props = { sessionId: "bench", messages, viewStateScope: {} };
// Streaming-frame equivalent: a NEW messages array where only the last
// assistant message's content grew by a token (the live reply).
const growth = "MORE".repeat(${TURNS > 80 ? 20 : 8});
const streamingMessages = messages.map((m, i) => (i === messages.length - 1 && !m.streaming)
  ? { ...m, content: m.content + growth, streaming: true }
  : i === messages.length - 2 && m.role === "assistant"
    ? { ...m, streaming: true }
    : m);
const streamingProps = { ...props, messages: streamingMessages };

const container = document.createElement("div");
document.body.appendChild(container);
const root = createRoot(container);

function median(ns) { const s=[...ns].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }

let mountT0 = performance.now();
act(() => { root.render(createElement(MessageTurns, props)); });
const mountMs = performance.now() - mountT0;
const mounts = [];
for (let i = 0; i < ${SAMPLES}; i++) {
  const t0 = performance.now();
  act(() => { root.render(createElement(MessageTurns, props)); });
  mounts.push(performance.now() - t0);
}
const mounted = container.querySelectorAll("[data-conversation-user-turn]").length;
act(() => { root.render(createElement(MessageTurns, streamingProps)); });
const streams = [];
for (let i = 0; i < ${SAMPLES}; i++) {
  const t0 = performance.now();
  act(() => { root.render(createElement(MessageTurns, streamingProps)); });
  streams.push(performance.now() - t0);
}
console.log(JSON.stringify({ bundled: true, turns: TURNS, samples: ${SAMPLES}, mountMs, mounted,
  keystrokeMedianMs: median(mounts), keystrokeMaxMs: Math.max(...mounts),
  streamingMedianMs: median(streams), streamingMaxMs: Math.max(...streams) }));
`;

const result = esbuild.buildSync({
  stdin: { contents: entry, resolveDir: path.join(REPO_ROOT, "packages/ui"), sourcefile: "render-entry.tsx", loader: "tsx" },
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".svg": "text" },
  write: false,
  absWorkingDir: path.join(REPO_ROOT, "packages/ui"),
  external: ["jsdom"],
  alias: {
    react: path.join(REPO_ROOT, "node_modules/.pnpm/react@18.3.1/node_modules/react"),
    "react-dom": path.join(REPO_ROOT, "node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom"),
    "react/jsx-runtime": path.join(REPO_ROOT, "node_modules/.pnpm/react@18.3.1/node_modules/react/jsx-runtime.js"),
  },
  logLevel: "silent",
});
const tmpFile = path.join(REPO_ROOT, "packages/ui", `.tierb-${process.pid}.cjs`);
fs.writeFileSync(tmpFile, result.outputFiles[0].text);
try {
  require(tmpFile);
} catch (error) {
  console.error("[perf tier-b] runtime failure:", error && error.message ? error.message : error);
  process.exit(3);
} finally {
  fs.unlinkSync(tmpFile);
}