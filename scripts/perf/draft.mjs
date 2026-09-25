#!/usr/bin/env node
/** Composer draft store per-keystroke micro-benchmark (esbuild-bundled). */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const esbuildDir = fs.readdirSync(path.join(REPO_ROOT, "node_modules/.pnpm"))
  .filter((d) => d.startsWith("esbuild@"))
  .map((d) => path.join(REPO_ROOT, "node_modules/.pnpm", d, "node_modules/esbuild"))
  .find((d) => fs.existsSync(path.join(d, "package.json")));
if (!esbuildDir) { console.error("[perf draft] esbuild not found in pnpm store"); process.exit(2); }
const { buildSync } = createRequire(import.meta.url)(esbuildDir);

const entry = `
import { createComposerDraftSource } from "./src/chat/composer-draft-store";
function median(ns){const s=[...ns].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function bench(fn,samples=600){fn();const runs=[];for(let i=0;i<samples;i++){const t0=process.hrtime.bigint();fn();runs.push(Number(process.hrtime.bigint()-t0)/1e6);}return {medianMs:median(runs),maxMs:Math.max(...runs)};}
const report={};
for (const [label,seed] of [["plain 0.5KB","hello ".repeat(100)],["plain 5KB","hello world, this is a drafting sentence. ".repeat(120)],["plain 20KB","words words words drafting ".repeat(1400)]]) {
  const source = createComposerDraftSource(undefined, "bench-"+label);
  source.set(seed);
  let text = seed;
  report[label] = bench(() => { text += "x"; source.set(text); });
}
const src = createComposerDraftSource(undefined, "bench-read");
src.set("x".repeat(20000));
report.readSnapshot20KB = bench(() => { void src.getSnapshot(); });
report.setWithSubscriber = (() => { let c=0; const off=src.subscribe(()=>{c++;}); const m=bench(()=>src.set("y".repeat(20000))); off(); return m; })();
import { composerDraftDocument, updateLegacyDraftDocument } from "./src/chat/composer-draft-document";
import { ResidentInputProjection } from "./src/chat/composer-resident-input";
const big="words words words drafting ".repeat(1400);
const doc0=composerDraftDocument([{kind:"text",text:big}]);
let tx=big;
report.breakdown = {
  updateLegacyDraftDocument: bench(()=>{tx+="x"; updateLegacyDraftDocument(doc0,tx); },600).medianMs,
  composerDraftDocument: bench(()=> composerDraftDocument([{kind:"text",text:tx}]),600).medianMs,
  projectionUpdate: (()=>{const pr=new ResidentInputProjection();const dd=composerDraftDocument([{kind:"text",text:tx}]);return bench(()=>pr.update(dd),600).medianMs;})(),
};
console.log(JSON.stringify(report,null,2));
`;
const result = buildSync({
  stdin: { contents: entry, resolveDir: path.join(REPO_ROOT, "packages/ui"), sourcefile: "draft-entry.ts", loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: path.join(REPO_ROOT, "packages/ui"), logLevel: "silent",
});
const tmpFile = path.join(REPO_ROOT, "packages/ui", `.draftbench-${process.pid}.cjs`);
fs.writeFileSync(tmpFile, result.outputFiles[0].text);
try { createRequire(import.meta.url)(tmpFile); } catch (e) { console.error("[perf draft] runtime failure:", e && e.message ? e.message : e); process.exit(3); }
finally { try { fs.unlinkSync(tmpFile); } catch {} }
