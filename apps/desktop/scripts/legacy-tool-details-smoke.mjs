import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function smokeLegacyToolDetails({ evaluate, wait, call }) {
  assert.ok(await evaluate("!!document.querySelector('[data-workspace-file-preview]')"), 'begin with the existing file preview');
  await evaluate(`(() => {
    window.__legacyBeforeFile=document.querySelector('[data-workspace-file-preview]').textContent;
    window.__legacyBeforeChat=document.querySelector('[data-content-header-title]').cloneNode(true);
    window.__legacyOff=window.__probeCtx.slots.register({name:'conversation.details.tool',priority:-100,id:'legacy-details-probe'}, owner => {
      window.__legacyOwner=owner;
      return window.__probeCreateElement('div',{'data-legacy-probe':owner.sessionId},'LEGACY_DETAIL '+owner.block.callId);
    });
  })()`);
  await wait(() => evaluate("Array.from(document.querySelectorAll('[role=tab]')).some(n=>/^(Tool-call details|工具调用详情)$/.test(n.textContent))"));
  await evaluate("Array.from(document.querySelectorAll('[role=tab]')).find(n=>/^(Tool-call details|工具调用详情)$/.test(n.textContent)).click();void 0");
  await wait(() => evaluate("document.querySelector('[data-legacy-tool-details] select')?.options.length>1"));
  await evaluate(`(() => {
    const select=document.querySelector('[data-legacy-tool-details] select');
    select.value=select.options[1].value;
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await wait(() => evaluate("!!document.querySelector('[data-legacy-probe]')"));
  assert.ok(await evaluate(`(() => {
    const owner=window.__legacyOwner;
    const snapshot=window.__probeCtx.sessions.binding(window.__compatSessionId).session.getSnapshot();
    const find=blocks=>blocks.some(block=>block===owner.block||find(block.subCalls??[]));
    return owner.sessionId===window.__compatSessionId && find([...snapshot.nodes.filter(n=>n.kind==='tool-result'),...snapshot.runningCalls])
      && document.querySelector('[data-content-header-title]').isEqualNode(window.__legacyBeforeChat);
  })()`), 'dispatch must use the exact official selected slice and retain native title');
  await writeFile(path.join(tmpdir(),'amiba-legacy-tool-details.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("window.__legacyOff();void 0");
  await wait(() => evaluate("!document.querySelector('[data-legacy-tool-details]') && document.querySelector('[data-workspace-file-preview]')?.textContent===window.__legacyBeforeFile"));
  assert.equal(await evaluate("document.querySelector('[data-workspace-file-preview]').textContent"),await evaluate('window.__legacyBeforeFile'), 'unload must restore the previous file preview');
  console.log('Legacy tool details passed real selected Host slice, retained native title and restoration of the original file preview after unload.');
}
