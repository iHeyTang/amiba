import { Context } from '@deepseek-ai/cordis';
import { afterEach, expect, it, vi } from 'vitest';
import { FileUploadRuntime } from './file-upload.js';
import { fileUploadWorker, parseFileUploadResult } from './file-upload-background.js';

afterEach(() => vi.unstubAllGlobals());
const receipt={ok:true,value:{receiptId:'r',file:{attachmentId:'digest',name:'a.bin',bytes:3}}};
it('uses the page-owned streaming hook, reports progress and retains byte-array Remote fallback',async()=>{
  let received:number[]=[];
  const transport=vi.fn(async(url:URL,init:RequestInit)=>{
    expect(url.pathname).toBe('/api/session/uploadFileBinary');
    expect(url.searchParams.get('sessionId')).toBe('s');
    expect((init as RequestInit & { duplex?: string }).duplex).toBe('half');
    const reader=(init.body as ReadableStream<Uint8Array>).getReader();
    while(true){const item=await reader.read();if(item.done)break;received.push(...item.value);}
    return new Response(JSON.stringify(receipt));
  });
  vi.stubGlobal('__DSH_FILE_UPLOAD__',{fetch:transport});
  const ctx=new Context();const remote=vi.fn(async()=>receipt);ctx.provide('remote',{fileUploads:{upload:remote}});
  const service=new FileUploadRuntime(ctx);const progress=vi.fn();
  expect(service.available).toBe(true);
  expect(await service.upload('s',new Blob([new Uint8Array([0,255,42])]),'a.bin',undefined,progress)).toEqual(receipt);
  expect(received).toEqual([0,255,42]);expect(progress).toHaveBeenLastCalledWith({loaded:3,total:3});
  received=[];
  await service.upload('s',new ReadableStream({start(controller){controller.enqueue(new Uint8Array([0]));controller.enqueue(new Uint8Array([255,42]));controller.close();}}),'a.bin',undefined,progress);
  expect(received).toEqual([0,255,42]);expect(progress).toHaveBeenLastCalledWith({loaded:3});
  await service.upload('s',new Uint8Array([1]));expect(remote).toHaveBeenCalledOnce();
});
it('aborts pending uploads when their providing plugin is unloaded',async()=>{
  let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});let signal:AbortSignal|undefined;
  vi.stubGlobal('__DSH_FILE_UPLOAD__',{fetch:async(_url:URL,init:RequestInit)=>{signal=init.signal!;started();return await new Promise<Response>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true}));}});
  const root=new Context();root.provide('remote',{fileUploads:{upload:vi.fn()}});let service!:FileUploadRuntime;
  const owner=await root.inject(['remote'],ctx=>{service=new FileUploadRuntime(ctx);});
  const result=service.upload('s',new Blob(['a']));const rejected=expect(result).rejects.toThrow();
  await began;await owner.dispose();await rejected;expect(signal?.aborted).toBe(true);
});
it('worker streams with progress and parser rejects malformed success payloads',async()=>{
  const postMessage=vi.fn();const scope={onmessage:null as any,postMessage};
  const doFetch=vi.fn(async(_url:string,init:any)=>{
    const reader=init.body.getReader();const parts=[];
    while(true){const item=await reader.read();if(item.done)break;parts.push(...item.value);}
    expect(parts).toEqual([0,255,42]);expect(init.credentials).toBe('include');
    return new Response(JSON.stringify(receipt));
  });
  fileUploadWorker(scope,()=>{throw new Error('stream must not use XHR')},doFetch);
  scope.onmessage({data:{url:'http://localhost/api/session/uploadFileBinary',headers:{},body:new ReadableStream({start(c){c.enqueue(new Uint8Array([0,255,42]));c.close();}})}});
  await vi.waitFor(()=>expect(postMessage).toHaveBeenCalledWith({kind:'complete',status:200,body:JSON.stringify(receipt)}));
  expect(postMessage).toHaveBeenCalledWith({kind:'progress',loaded:3});
  expect(()=>parseFileUploadResult('{"ok":true,"value":{}}')).toThrow('invalid receipt');
  expect(parseFileUploadResult('{"ok":false,"error":{"code":"denied","message":"no","details":{}}}')).toMatchObject({ok:false,error:{code:'denied'}});
});
