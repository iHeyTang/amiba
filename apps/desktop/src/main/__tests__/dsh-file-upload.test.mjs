import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DshFileUploadCarrier } from '../dsh-file-upload.ts';

test('streams acknowledged bytes, confines owners and destinations, cancels on owner release', async t => {
  let firstChunk; const first = new Promise(resolve => { firstChunk = resolve; });
  let received = Buffer.alloc(0);
  let disconnected; const closed = new Promise(resolve => { disconnected = resolve; });
  const server = createServer((req,res) => {
    req.on('data', chunk => { received = Buffer.concat([received,chunk]); firstChunk(); });
    req.on('end', () => res.end(JSON.stringify({ bytes: received.length })));
    res.on('close', () => { if (!res.writableEnded) disconnected(); });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => { server.closeAllConnections();server.close(); });
  const base=`http://127.0.0.1:${server.address().port}`;
  const carrier = new DshFileUploadCarrier();
  t.after(() => carrier.release(1));
  assert.throws(() => carrier.open(1,'http://foreign.invalid/api/session/uploadFileBinary',base));
  assert.throws(() => carrier.open(1,'/api/settings/replace',base));
  const id=carrier.open(1,'/api/session/uploadFileBinary?sessionId=s',base);
  await assert.rejects(carrier.write(2,id,new Uint8Array([1])),/window/);
  await assert.rejects(carrier.write(1,id,new Uint8Array(65537)),/chunk/);
  await carrier.write(1,id,new Uint8Array([0,255,42]));
  await first;
  assert.deepEqual(received,Buffer.from([0,255,42]));
  await carrier.write(1,id,new Uint8Array([128,7]));
  assert.deepEqual(await carrier.finish(1,id),{status:200,body:'{"bytes":5}'});
  await assert.rejects(carrier.write(1,id,new Uint8Array([1])),/window/);
  const pending=carrier.open(1,'/api/session/uploadFileBinary?sessionId=s',base);
  await carrier.write(1,pending,new Uint8Array([1]));
  // Allow the server to observe the second open upload before tearing it down.
  await new Promise(resolve => setTimeout(resolve,20));
  carrier.release(1);
  await closed;
  await assert.rejects(carrier.finish(1,pending),/window/);
});

test('renderer bounds IPC chunks and cancels a pending source read', async () => {
  const { createDshFileUploadFetch } = await import('../../renderer/dsh-file-upload.ts');
  const chunks=[];let writing=false;let cancelled=false;
  const bridge={uploadOpen:async()=> 'id',uploadWrite:async(_id,bytes)=>{assert.equal(writing,false);writing=true;await Promise.resolve();chunks.push(bytes);writing=false;},uploadFinish:async()=>({status:200,body:'ok'}),uploadCancel:async()=>{cancelled=true;}};
  const send=createDshFileUploadFetch(bridge,'http://127.0.0.1:80');
  const data=new Uint8Array(150000);data[149999]=42;
  const response=await send(new URL('http://dsh.internal/api/session/uploadFileBinary'),{method:'POST',duplex:'half',body:new ReadableStream({start(c){c.enqueue(data);c.close();}})});
  assert.equal(await response.text(),'ok');assert.deepEqual(chunks.map(x=>x.length),[65536,65536,18928]);assert.equal(chunks[2].at(-1),42);
  const abort=new AbortController();let sourceCancelled=false;
  const pending=send(new URL('http://dsh.internal/api/session/uploadFileBinary'),{method:'POST',duplex:'half',signal:abort.signal,body:new ReadableStream({cancel(){sourceCancelled=true;}})});
  const rejected=assert.rejects(pending,{name:'AbortError'});
  await Promise.resolve();abort.abort();await rejected;
  assert.equal(cancelled,true);assert.equal(sourceCancelled,true);
});
