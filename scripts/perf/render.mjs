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
const messages = [];
for (let i = 0; i < TURNS; i++) {
  messages.push({ uiId: \`u\${i}\`, role: "user", content: \`Question number \${i} with some body text\` });
  messages.push({ uiId: \`a\${i}\`, role: "assistant", content: \`Answer number \${i} — longer markdown body with **bold** and \` + "\`code\`".repeat(60) + " ".repeat(0) + " para two: " + "words ".repeat(180), assistantMessageId: \`a\${i}-msg\` });
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

act(() => { root.render(createElement(MessageTurns, props)); });
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
console.log(JSON.stringify({ bundled: true, turns: TURNS, samples: ${SAMPLES}, mounted,
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