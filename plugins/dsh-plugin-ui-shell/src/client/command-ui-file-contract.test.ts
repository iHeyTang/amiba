import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('preserves attachment capability through the shipped official command source', async () => {
  const require=createRequire(import.meta.url);let module:any;
  const bundle=await readFile(require.resolve('@deepseek-ai/dsh-client-ui-commands/client'),'utf8');
  runInNewContext(bundle,{window:{__ModuleLoader__:{load:(entry:any)=>{module=entry.factory((id:string)=>id==='@deepseek-ai/cordis'?{Service:class{}}:{});}}}});
  const prototype=module.CommandUiRuntime.prototype;
  let descriptor={name:'files',description:'files',input:{hint:'file',attachments:true}} as any;
  const execute=vi.fn(async()=>({kind:'success'}));
  const source:any={execute,t:()=> 'images unsupported',live:{contributions:new Map(),decorations:new Map()},directory:{ensureReady:async()=>{},resolve:()=>descriptor}};
  source.leadingClaim=(desc:any,session:any)=>prototype.leadingClaim.call(source,desc,session);
  const session={sessionId:'s'};
  const result=await prototype.matchEnter.call(source,session,'/files args',new AbortController().signal,{images:0,attachments:1});
  expect(result.claim.attachments).toBe(true);
  const files=[{type:'file',receiptId:'r'}];await result.claim.submit('args',{},files);
  expect(execute).toHaveBeenCalledWith(session,'/files args',files);
  descriptor={name:'files',input:{hint:'image',images:true}};
  await expect(prototype.matchEnter.call(source,session,'/files args',new AbortController().signal,{images:0,attachments:1})).rejects.toThrow('file attachments');
  descriptor={name:'files',input:{hint:'none',images:true,attachments:false}};
  await expect(prototype.matchEnter.call(source,session,'/files args',new AbortController().signal,{images:1,attachments:1})).rejects.toThrow('images unsupported');
});
