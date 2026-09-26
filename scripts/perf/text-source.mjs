#!/usr/bin/env node
/** text-source-ranges micro-benchmark (thinking-fold timeline mapping). */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const esbuildDir = fs.readdirSync(path.join(REPO_ROOT, "node_modules/.pnpm"))
  .filter(d=>d.startsWith("esbuild@")).map(d=>path.join(REPO_ROOT,"node_modules/.pnpm",d,"node_modules/esbuild"))
  .find(d=>fs.existsSync(path.join(d,"package.json")));
const { buildSync } = createRequire(import.meta.url)(esbuildDir);
const entry = `
import { joinTextSources, timelineTextSource } from "./src/chat/text-source-ranges";
function med(ns){const s=[...ns].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function b(fn,n=200){fn();const r=[];for(let i=0;i<n;i++){const t=process.hrtime.bigint();fn();r.push(Number(process.hrtime.bigint()-t)/1e6);}return {medianMs:med(r),maxMs:Math.max(...r)};}
const sizes = [10000, 50000, 200000];
const out = {};
for (const sz of sizes) {
  const text = ("thinking about the problem step by step ".repeat(Math.ceil(sz/37))).slice(0, sz);
  const item = { kind: "text", text };
  out[sz] = {
    extract: b(()=> timelineTextSource(item), 100).medianMs,
    join: b(()=> joinTextSources([timelineTextSource(item), timelineTextSource(item)], ""), 100).medianMs,
  };
}
console.log(JSON.stringify(out,null,2));
`;
const result = buildSync({ stdin:{contents:entry, resolveDir:path.join(REPO_ROOT,"packages/ui"), sourcefile:"ts.ts", loader:"ts"}, bundle:true, platform:"node", format:"cjs", write:false, absWorkingDir:path.join(REPO_ROOT,"packages/ui"), logLevel:"silent" });
const tmp=path.join(REPO_ROOT,"packages/ui",`.tsbench-${process.pid}.cjs`);
fs.writeFileSync(tmp, result.outputFiles[0].text);
try { createRequire(import.meta.url)(tmp); } catch(e){ console.error("runtime failure:", e && (e.stack || e.message) || e); process.exit(3); }
finally { try{fs.unlinkSync(tmp);}catch{} }
