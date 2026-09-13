import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function smokeFileProvider({ evaluate, wait, fileWorkspace }) {
  const folder = path.join(fileWorkspace, '.cache', 'compat-resource-probe');
  const file = path.join(folder, 'a #?.txt');
  await mkdir(folder, { recursive: true });
  try {
    await evaluate(`(async()=>{
      window.__fileNativeEvents=0;
      window.__fileNativeObservation=window.amiba.files.observe(window.__compatSessionId,'.cache/compat-resource-probe/a #?.txt',()=>{window.__fileNativeEvents++});
      await window.__fileNativeObservation.ready;
      const cancelled=window.amiba.files.observe(window.__compatSessionId,'.cache/compat-resource-probe/cancel-before-ready',()=>{throw new Error('Cancelled observer delivered')});
      cancelled.dispose();
      await cancelled.ready;
      const denied=window.amiba.files.observe(window.__compatSessionId,'../outside-resource/file',()=>{});
      window.__fileObserveDenied=await denied.ready.then(()=>false,error=>String(error).includes('outside this conversation'));
      denied.dispose();
    })()`);
    assert.equal(await evaluate("window.__fileObserveDenied"), true);
    await evaluate(`(async()=>{
      const ctx=window.__probeCtx,h=window.__probeCreateElement;
      window.__fileResourceAddress='dsh-resource://file/session/'+encodeURIComponent(window.__compatSessionId)+'/.cache/compat-resource-probe/a%20%23%3F.txt';
      window.__fileResourceFiber=await ctx.inject(['resources'],child=>{
        window.__fileResourceSource=child.resources.source(window.__fileResourceAddress);
      });
      window.__fileResourceOff=ctx.slots.register({name:'sidebar.footer.action',id:'file-resource-probe'},props=>{
        const state=props.useResource(window.__fileResourceAddress);
        return h('output',{'data-file-resource-probe':true},state.status+':'+(state.value?.bytes??''));
      });
    })()`);
    await wait(() => evaluate("document.querySelector('[data-file-resource-probe]')?.textContent==='failed:'"));
    assert.equal(await evaluate("window.__fileResourceSource.getSnapshot().failure.code"), 'workspace-file/not-found');
    await writeFile(file, 'first');
    await wait(() => evaluate('window.__fileNativeEvents>0'));
    await wait(() => evaluate("document.querySelector('[data-file-resource-probe]')?.textContent==='live:5'"));
    assert.equal(await evaluate("window.__fileResourceSource.getSnapshot().value.absolutePath"), await realpath(file));
    const version = await evaluate("window.__fileResourceSource.getSnapshot().value.version");
    await writeFile(file, 'a longer update');
    await wait(() => evaluate("document.querySelector('[data-file-resource-probe]')?.textContent==='live:15'"));
    assert.notEqual(await evaluate("window.__fileResourceSource.getSnapshot().value.version"), version);
    await rm(file);
    await wait(() => evaluate("document.querySelector('[data-file-resource-probe]')?.textContent==='failed:15'"));
    await writeFile(file, 'back');
    await wait(() => evaluate("document.querySelector('[data-file-resource-probe]')?.textContent==='live:4'"));
    await evaluate("window.__fileResourceOff();window.__fileResourceOff=undefined");
    await wait(() => evaluate("window.__fileResourceSource.getSnapshot().value===undefined && !document.querySelector('[data-file-resource-probe]')"));
    await evaluate('window.__fileNativeObservation.dispose()');
    const eventCount = await evaluate('window.__fileNativeEvents');
    await writeFile(file, 'after native disposal');
    await delay(200);
    assert.equal(await evaluate('window.__fileNativeEvents'), eventCount);
    console.log('Native observation crossed real IPC, readiness, early cancellation, outside rejection and disposal.');
    console.log('Real file resource hook recovered missing/create/update/delete/recreate in tree-ignored .cache; failure retained last value and final unmount cleared state.');
  } finally {
    await evaluate("window.__fileNativeObservation?.dispose();window.__fileResourceOff?.();window.__fileResourceFiber?.dispose()");
    await rm(folder, { recursive: true, force: true });
  }
}
