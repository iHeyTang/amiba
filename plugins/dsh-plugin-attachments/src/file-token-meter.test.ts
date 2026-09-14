import { Context } from '@deepseek-ai/cordis';
import { createRequire } from 'node:module';
import { createUserMessage, fileHandleText } from '@deepseek-ai/dsh-llm';
import { expect, it } from 'vitest';

const agentRequire=createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent'));
const {default:TokenMeter}=await import(/* @vite-ignore */ agentRequire.resolve('@deepseek-ai/dsh-token-meter'));
const file={attachmentId:`sha256:${'ab'.repeat(32)}` as any,name:'notes.bin',bytes:3};
const textTokens=(text:string)=>Math.ceil(text.length/4)+8;
const event=(seq:number,content:any[],surfaceOp:any='append')=>({seq,type:'user/message',time:1,data:createUserMessage({content,source:{kind:'user'}}),surfaceOp});

it('prices files as the exact model handle, reprices changed paths and replays replacement history',()=>{
  const ctx=new Context();let path:string|undefined='/initial/notes.bin';
  ctx.provide('llm',{fileRequestText:(ref:any)=>fileHandleText(ref,path)} as any);
  const meter=new TokenMeter(ctx);const session:any={events:[event(0,[{type:'file',attachment:file}])]};
  const first=meter.measure(session);
  expect(first.surfaceTokens).toBe(textTokens(fileHandleText(file,path)));
  expect(first.totalTokens).toBe(first.surfaceTokens);expect(first.nodes).toEqual([{seq:0,tokens:first.surfaceTokens,heuristicTokens:meter.estimateMessage(session.events[0].data)}]);
  const original=session.events[0].data;
  path='/a/much/longer/execution/environment/notes.bin';
  expect(meter.measure(session).surfaceTokens).toBe(textTokens(fileHandleText(file,path)));
  path=undefined;
  expect(meter.measure(session).surfaceTokens).toBe(textTokens(fileHandleText(file,undefined)));
  expect(session.events[0].data).toBe(original);expect(original.content[0].type).toBe('file');
  session.events.push(event(1,[{type:'text',text:'replacement'}],{start:0,end:0}));
  const replaced=meter.measure(session);expect(replaced.surfaceTokens).toBe(textTokens('replacement'));
  expect(new TokenMeter(new Context()).measure(session)).toEqual(replaced);
});
it('retains ordinary text pricing and prices nested files with the same service projection',()=>{
  const ctx=new Context();const meter=new TokenMeter(ctx);
  const plain=createUserMessage({content:[{type:'text',text:'unchanged'}],source:{kind:'user'}});
  expect(meter.estimateMessage(plain)).toBe(textTokens('unchanged'));
  const nested=createUserMessage({content:[{type:'tool-result',toolCallId:'call',content:[{type:'file',attachment:file}]} as any],source:{kind:'user'}});
  expect(meter.estimateMessage(nested)).toBe(Math.ceil(JSON.stringify({type:'file',attachment:file}).length/4)+12);
  expect(meter.measure({events:[event(0,nested.content)]}).surfaceTokens).toBe(textTokens(fileHandleText(file,undefined))+4);
});
it('keeps provider usage anchors consistent across file path repricing and subsequent text',()=>{
  const ctx=new Context();let path='/one';ctx.provide('llm',{fileRequestText:(ref:any)=>fileHandleText(ref,path)} as any);
  const meter=new TokenMeter(ctx);
  const session:any={events:[event(0,[{type:'file',attachment:file}]),
    {seq:1,type:'step/start',time:1,data:{turn:1,step:1}},
    {seq:2,type:'request/header',time:1,data:{header:{config:{provider:'test',model:'m'}}}},
    {seq:3,type:'assistant/message',time:1,surfaceOp:'append',data:{turn:1,step:1,message:{id:'assistant',role:'assistant',source:{kind:'model',provider:'test',model:'m'},content:[{type:'text',text:'answer'}]},usage:{inputTokens:1000,outputTokens:10}}},
    {seq:4,type:'step/end',time:1,data:{turn:1,step:1}}]};
  const first=meter.measure(session);expect(first.baseline.kind).toBe('usage');expect(first.totalTokens).toBe(1010);
  path='/a/new/mapped/path';expect(meter.measure(session).totalTokens).toBe(1010);
  session.events.push(event(5,[{type:'text',text:'next'}]));
  expect(meter.measure(session).totalTokens).toBe(1010+textTokens('next'));
});

it('keeps compaction shadow claims compatible with structural history projections',async()=>{
  const {readFile}=await import('node:fs/promises');const {runInNewContext}=await import('node:vm');
  const {deriveEventMessage}=await import('@deepseek-ai/dsh-session');
  const require=createRequire(import.meta.url);
  const basic=await readFile(require.resolve('@deepseek-ai/dsh-compaction-basic'),'utf8');
  const meterSource=await readFile(agentRequire.resolve('@deepseek-ai/dsh-token-meter'),'utf8');
  const prepareCode=basic.slice(basic.indexOf('function prepareCompaction('),basic.indexOf('/** Run the summarizer'));
  const prepare=runInNewContext(prepareCode+'\nprepareCompaction',{SurfaceChangedError:Error,buildSummarizationInput:()=>({})});
  const foldCode=meterSource.slice(meterSource.indexOf('function foldSurfaceProjection('),meterSource.indexOf('//#endregion',meterSource.indexOf('function foldSurfaceProjection(')));
  const ctx=new Context();const meter=new TokenMeter(ctx);const original=event(0,[{type:'file',attachment:file}]);const session:any={events:[original]};
  const prepared=prepare({meter},session,{startIdx:0,endIdx:0,shadowedSeqs:[0]});
  expect(prepared.shadowedTokenCount).toBe(meter.estimateMessage(original.data));
  expect(prepared.shadowedTokenCount).not.toBe(meter.measure(session).surfaceTokens);
  const fold=runInNewContext(foldCode+'\nfoldSurfaceProjection',{deriveEventMessage,isSurfaceEvent:(event:any)=>event.surfaceOp!==undefined,estimateMessage:(message:any)=>meter.estimateMessage(message)});
  const initial=fold(undefined,original);
  const claim=fold(undefined,{type:'compaction/summary',data:{shadowedRange:{start:0,end:0},shadowedTokenCount:prepared.shadowedTokenCount}}).claim;
  const replacement=event(2,[{type:'text',text:'summary'}],{start:0,end:0});
  expect(initial.deltaTokens+fold(claim,replacement).deltaTokens).toBe(meter.estimateMessage(replacement.data));
});
