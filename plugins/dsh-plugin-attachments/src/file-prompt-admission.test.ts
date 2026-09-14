import { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { createScope } from '@deepseek-ai/dsh-scope';
import { FileUploads } from './file-uploads.js';
import { createOfficialFileStorage } from './official-file-storage/index.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('the installed prompt boundary validates receipts before image writes, rolls back refusal, and binds successful delivery',async()=>{
  const source=await readFile(new URL('../../../packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js',import.meta.url),'utf8');
  const helper=source.slice(source.indexOf('async function durablePromptContent('),source.indexOf('/** Search durable content for an image'));
  const start=source.indexOf('async prompt(request) {');const end=source.indexOf('\n\t\t\tasync attachment(request)',start);
  const method=source.slice(start,end).replace(/,\s*$/,'');
  const root=await mkdtemp(join(tmpdir(),'amiba-prompt-files-'));const ctx=new Context();
  const storage=createOfficialFileStorage(join(root,'files','v1'));
  const saveImages=vi.fn(async(images:any[])=>images.map(()=>({attachmentId:'image',mediaType:'image/png',width:1,height:1,bytes:1})));
  ctx.provide('attachments',{...storage,saveImages} as any);
  const agent:any={id:'owner',session:{header:{origin:'user'}},followup:vi.fn(),steer:vi.fn()};
  const scope=createScope(ctx,agent);agent.ctx=scope.ctx;
  ctx.provide('agents',{get:()=>agent} as any);ctx.provide('llm',{resolveModelInfo:async()=>({inputModalities:['image']})} as any);
  const uploads=new FileUploads(ctx,storage);
  class AttachmentError extends Error {code:string;constructor(message:string,code:string){super(message);this.code=code;}}
  const prompt=runInNewContext(helper+'\n({'+method+'}).prompt',{
    ctx,createUserMessage,AttachmentError,Symbol,
    turnAgentFor:async()=>({agent}),selectionFor:()=>({current:{provider:'test',model:'m'}}),
    serializeImageAdmission:(_agent:any,fn:()=>unknown)=>fn(),
    admitEncodedImages:async(store:any,images:any[])=>store.saveImages(images),
    ok:(_r:any,value:any)=>({ok:true,value}),err:(_r:any,error:any)=>({ok:false,error}),
  });
  try{
    const value=await uploads.upload(agent,{data:'AP8q',name:'a.bin'},new AbortController().signal);
    const file={type:'file',receiptId:value.receiptId};const image={type:'image',mediaType:'image/png',data:'AA=='};
    const submit=(rpcId:string,content:any[],mode='queue')=>prompt({rpcId,payload:{sessionId:agent.id,content,mode}});
    expect(await submit('bad',[image,{type:'file',receiptId:'foreign'}])).toMatchObject({ok:false,error:{code:'attachment-error',details:{reason:'FILE_NOT_STAGED'}}});
    expect(saveImages).not.toHaveBeenCalled();expect(agent.followup).not.toHaveBeenCalled();
    agent.followup.mockImplementationOnce(()=>{throw new Error('busy')});
    expect(await submit('failed',[file])).toMatchObject({ok:false,error:{code:'agent-busy'}});
    uploads.retirePrompt(agent,'failed');expect(uploads.resolve(agent,value.receiptId)).toBeDefined();
    expect(await submit('success',[{type:'text',text:'read'},file,image,file],'steer')).toEqual({ok:true,value:{accepted:true}});
    const message=agent.steer.mock.calls[0]?.[0];
    expect(message.content.map((part:any)=>part.type)).toEqual(['text','file','image','file']);
    expect(message.source.rpcId).toBe('success');expect(message.content[1].attachment).toEqual(value.file);
    expect(saveImages).toHaveBeenCalledTimes(2); // Failed file-only attempt keeps the old empty-image admission behavior.
    uploads.retirePrompt(agent,'success');expect(uploads.resolve(agent,value.receiptId)).toBeUndefined();
  }finally{await scope.dispose();await rm(root,{recursive:true,force:true});}
});
