#!/usr/bin/env node
/** Real-log session materialization benchmark: decode + line parse + UiMessage-style model build. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
function median(ns){const s=[...ns].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function decodeSessionLog(file){const buf=fs.readFileSync(file);const magic=Buffer.from([0x28,0xb5,0x2f,0xfd]);const parts=[];let idx=0;while(idx<buf.length){const m=buf.indexOf(magic,idx);if(m<0)break;const n=buf.indexOf(magic,m+4);const e=n<0?buf.length:n;try{parts.push(zstdDecompressSync(buf.subarray(m,e)));}catch{}idx=Math.max(m+4,e);}return Buffer.concat(parts);}
const sessionsDir = process.argv[2] ?? path.join(os.homedir(),"Library/Application Support/@amiba/desktop/dsh/home/sessions");
const dirs=[];for(const ws of fs.readdirSync(sessionsDir,{withFileTypes:true}).filter(d=>d.isDirectory())){const w=path.join(sessionsDir,ws.name);for(const d of fs.readdirSync(w,{withFileTypes:true})){if(!d.isDirectory())continue;const log=path.join(w,d.name,"session.v3.jsonl.zstd");if(fs.existsSync(log))dirs.push({log,size:fs.statSync(log).size});}}
dirs.sort((a,b)=>b.size-a.size);
const target=dirs[0];if(!target){console.error("no sessions");process.exit(1);}
const text=decodeSessionLog(target.log).toString("utf8");
console.log("session:", path.basename(path.dirname(target.log)), "| lines:", text.split("\n").length, "| decoded MB:", (text.length/1e6).toFixed(1));
function run(){
  const t0=process.hrtime.bigint();
  const msgs=[];let cur=null;let parses=0;
  for(const line of text.split("\n")){
    if(!line)continue;
    let e;try{e=JSON.parse(line);parses++;}catch{continue;}
    const kind=e.type||"";
    if(kind==="user/message"){cur={uiId:"u"+msgs.length,role:"user",content:e.content??"",runtimeSeq:msgs.length};msgs.push(cur);}
    else if(kind==="assistant/message"){cur={uiId:"a"+msgs.length,role:"assistant",content:e.content??"",assistantMessageId:"a-"+msgs.length,runtimeSeq:msgs.length};msgs.push(cur);}
    else if(cur&&(kind==="tool/call"||kind==="tool/result")){
      const arr=cur.toolProgress ??= [];
      arr.push({tool:e.tool??"tool",toolCallId:e.toolCallId??("t"+arr.length),status:kind==="tool/call"?"running":"completed",args:e.args,result:e.result});
    }
  }
  return {msMs:Number(process.hrtime.bigint()-t0)/1e6, msgs:msgs.length, toolProgress:msgs.reduce((n,m)=>n+(m.toolProgress?.length??0),0), parses};
}
const runs=Array.from({length:3},run);
const med=median(runs.map(r=>r.msMs));
console.log("materialize median ms:", med.toFixed(1), "| runs:", runs.map(r=>r.msMs.toFixed(1)).join(","));
console.log("model:", {messages:runs[0].msgs, toolProgress:runs[0].toolProgress, parses:runs[0].parses, worstLineKB:(text.split("\n").reduce((m,l)=>Math.max(m,l.length),0)/1e3).toFixed(1)});
