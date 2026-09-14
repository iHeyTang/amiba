import { Context, Service } from '@deepseek-ai/cordis';
import { expect, it, vi } from 'vitest';
import { FileUploadRuntime } from './file-upload.js';
import { FILE_UPLOAD_HOST, FILE_UPLOAD_REMOTE } from '../file-upload-remote.js';

function fixture() {
  const upload = vi.fn(async () => ({ok:true as const,value:{receiptId:'receipt',file:{attachmentId:'digest',name:'file.bin',bytes:3}}}));
  const ctx = new Context(); ctx.provide('remote',{fileUploads:{upload}});
  return {service:new FileUploadRuntime(ctx),upload};
}
it('uploads the exact byte view and Blob bytes without using native attachment IDs', async () => {
  const {service,upload}=fixture();
  const result=await service.upload('session-a',new Uint8Array([9,0,255,42,8]).subarray(1,4),'file.bin');
  expect(upload).toHaveBeenLastCalledWith('session-a',{data:'AP8q',name:'file.bin'},expect.any(AbortSignal));
  expect(result).toMatchObject({ok:true,value:{receiptId:'receipt'}});
  await service.upload('session-b',new Blob([new Uint8Array([0,255,42])]));
  expect(upload).toHaveBeenLastCalledWith('session-b',{data:'AP8q'},expect.any(AbortSignal));
});
it('honors cancellation before RPC and after asynchronous Blob reading', async () => {
  const {service,upload}=fixture(); const abort=new AbortController();abort.abort();
  await expect(service.upload('session',new Uint8Array([1]),undefined,abort.signal)).rejects.toThrow();
  const late=new AbortController();const blob=new Blob(['abc']);
  const original=blob.arrayBuffer.bind(blob);blob.arrayBuffer=async()=>{const value=await original();late.abort();return value;};
  await expect(service.upload('session',blob,undefined,late.signal)).rejects.toThrow();
  expect(upload).not.toHaveBeenCalled();
});
it('does not consume a stream when no background streaming carrier is mounted', async () => {
  const {service,upload}=fixture(); const stream=new ReadableStream<Uint8Array>();
  expect(service.available).toBe(false);
  await expect(service.upload('session',stream)).rejects.toThrow('background carrier');
  expect(stream.locked).toBe(false); expect(upload).not.toHaveBeenCalled();
});
it('uses the Host Agent lookup with matching strict browser and Host codecs', () => {
  const host=FILE_UPLOAD_HOST.invocations[0],client=FILE_UPLOAD_REMOTE.descriptors[0];
  expect(host.scope).toEqual({context:'agent',wire:'agentId'});
  expect(host.parameters[0]).toMatchObject({source:'lookup',lookup:'agent'});
  expect(host.implementation).toBe('uploadRemote');
  expect(host.result).toBe(client.result);
  expect(host.cancellation).toEqual({parameter:'signal'});
});

it('retains namespace authority when another plugin calls the upload service', async () => {
  const root=new Context();const call=vi.fn(async()=>({ok:true,value:{receiptId:'r',file:{attachmentId:'f',name:'a',bytes:1}}}));
  class Remote extends Service {constructor(ctx:Context){super(ctx,'remote');}}
  class Namespace extends Service {upload=call;constructor(ctx:Context){super(ctx,'remote.fileUploads');}}
  const remote=await root.plugin(Remote);const namespace=await root.plugin(Namespace);
  const owner=await root.inject(['remote','remote.fileUploads'],ctx=>{new FileUploadRuntime(ctx);});
  const consumer=await root.inject(['fileUpload'],async ctx=>{
    expect(() => ctx.remote.fileUploads).toThrow('without inject');
    expect(await ctx.fileUpload.upload('session',new Uint8Array([1]))).toMatchObject({ok:true});
  });
  expect(call).toHaveBeenCalledWith('session',{data:'AQ=='},expect.any(AbortSignal));
  await consumer.dispose();await owner.dispose();await namespace.dispose();await remote.dispose();
});
