import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createUserMessage, projectFilesToText, fileHandleText, type GenerateOptions } from '@deepseek-ai/dsh-llm';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import { expect, it } from 'vitest';
import { createOfficialFileStorage } from './official-file-storage/index.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class RecordingAdapter extends LlmAdapter {
  received?: GenerateOptions;
  async *stream(options: GenerateOptions) { this.received=options; }
}
const file={attachmentId:`sha256:${'ab'.repeat(32)}` as any,name:'notes "one".txt',bytes:3};
it('projects every file occurrence without mutating durable history or ordinary messages',()=>{
  const plain=createUserMessage({content:[{type:'text',text:'keep'}],source:{kind:'user'}});
  const original=createUserMessage({content:[{type:'file',attachment:file},{type:'tool-result',toolCallId:'call',content:[{type:'file',attachment:file}]} as any],source:{kind:'user'}});
  const messages=[plain,original];const result=projectFilesToText(messages,()=>'/mapped/notes.txt');
  expect(result[0]).toBe(plain);expect(result[1]).not.toBe(original);
  expect(result[1]?.content[0]).toEqual({type:'text',text:fileHandleText(file,'/mapped/notes.txt')});
  expect((result[1]?.content[1] as any).content[0].type).toBe('text');
  expect(original.content[0]?.type).toBe('file');expect(Object.isFrozen(original)).toBe(true);
  const untouched=[plain];expect(projectFilesToText(untouched,()=>{throw new Error('not a file')})).toBe(untouched);
});
it('dispatches handles on the real LLM service, using current execution paths and explicit missing-path text',async()=>{
  for(const mapping of ['/sandbox/notes.txt',undefined,'invalid'] as const){
    const ctx=new Context();
    ctx.provide('attachments',{fileHostPath:()=>{if(mapping==='invalid')throw new Error('invalid');return '/host/notes.txt';}} as any);
    ctx.provide('fs',{processPathFromHostPath:()=>mapping} as any);
    const owner=await ctx.plugin(LlmRuntime);const adapter=new RecordingAdapter();
    ctx.llm.registerAdapter(['file-test'],adapter);
    const original=createUserMessage({content:[{type:'file',attachment:file},{type:'text',text:'read'}],source:{kind:'user'}});
    try{
      const chunks=[];for await(const chunk of ctx.llm.stream({provider:'file-test',model:'m',messages:[original]}))chunks.push(chunk);
      expect(chunks).toEqual([]);
      const content=adapter.received?.messages[0]?.content;
      expect(content?.[0]?.type).toBe('text');
      expect((content?.[0] as any).text).toContain(mapping==='/sandbox/notes.txt'?'/sandbox/notes.txt':'cannot access a readable path');
      expect(content?.[1]).toBe(original.content[1]);expect(original.content[0]?.type).toBe('file');
      expect(ctx.llm.fileRequestText(file)).toBe((content?.[0] as any).text);
    }finally{await owner.dispose();}
  }
});
it('maps real durable bytes through the local filesystem without widening relative path handling',async()=>{
  const root=await mkdtemp(join(tmpdir(),'amiba-file-model-'));
  try{
    const storage=createOfficialFileStorage(join(root,'files','v1'));
    const ref=await storage.saveFile({data:new Uint8Array([0,255,42]),name:'notes.bin'});
    const path=LocalFileSystem.prototype.processPathFromHostPath(storage.fileHostPath(ref));
    expect(path).toBe(storage.fileHostPath(ref));expect(await readFile(path!)).toEqual(Buffer.from([0,255,42]));
    expect(LocalFileSystem.prototype.processPathFromHostPath('relative.bin')).toBeUndefined();
  }finally{await rm(root,{recursive:true,force:true});}
});

it('combines file handles with the existing text-only image policy at dispatch',async()=>{
  const ctx=new Context();const owner=await ctx.plugin(LlmRuntime);const adapter=new RecordingAdapter();
  adapter.resolveModel=async(provider,model)=>({provider,id:model,name:model,inputModalities:['text']});
  ctx.llm.registerAdapter(['text-test'],adapter);
  const original=createUserMessage({content:[{type:'file',attachment:file},{type:'image',attachment:{attachmentId:'sha256:image' as any,mediaType:'image/png',width:1,height:1,bytes:42}}],source:{kind:'user'}});
  try{
    const output=[];for await(const chunk of ctx.llm.stream({provider:'text-test',model:'m',messages:[original]}))output.push(chunk);
    expect(output).toEqual([]);expect(adapter.received?.messages[0]?.content.map(block=>block.type)).toEqual(['text','text']);
    expect((adapter.received?.messages[0]?.content[1] as any).text).toContain('image omitted');
    expect(original.content.map(block=>block.type)).toEqual(['file','image']);
  }finally{await owner.dispose();}
});
