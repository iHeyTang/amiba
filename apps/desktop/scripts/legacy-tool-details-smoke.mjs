import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function smokeLegacyToolDetails({ evaluate, wait, call, profile, live = false }) {
  assert.ok(await evaluate("!!document.querySelector('[data-workspace-file-preview]')"), 'begin with the existing file preview');
  await evaluate("window.__legacyFileNode=document.querySelector('[data-workspace-file-preview]');window.__probeCtx.layout.closeDetails();void 0");
  await wait(() => evaluate("document.querySelector('[data-workspace-tabbar]')?.closest('aside')?.getAttribute('aria-hidden')==='true'"));
  await evaluate("window.__probeCtx.layout.openDetails();window.__probeCtx.layout.openDetails();void 0");
  await wait(() => evaluate("document.querySelector('[data-workspace-tabbar]')?.closest('aside')?.getAttribute('aria-hidden')==='false'"));
  assert.ok(await evaluate("document.querySelector('[data-workspace-file-preview]')===window.__legacyFileNode"), 'official layout open/close must retain the original file preview DOM');
  await evaluate(`(() => {
    window.__legacyBeforeFile=document.querySelector('[data-workspace-file-preview]').textContent;
    window.__legacyBeforeChat=document.querySelector('[data-content-header-title]').cloneNode(true);
    window.__legacyOff=window.__probeCtx.slots.register({name:'conversation.details.tool',priority:-100,id:'legacy-details-probe'}, owner => {
      window.__legacyOwner=owner;
      return window.__probeCreateElement('div',{'data-legacy-probe':owner.sessionId,'data-legacy-state':'kind' in owner.block ? 'settled' : 'running'},'LEGACY_DETAIL '+owner.block.callId);
    });
  })()`);
  await wait(() => evaluate("Array.from(document.querySelectorAll('[role=tab]')).some(n=>/^(Tool-call details|工具调用详情)$/.test(n.textContent))"));
  await evaluate("Array.from(document.querySelectorAll('[role=tab]')).find(n=>/^(Tool-call details|工具调用详情)$/.test(n.textContent)).click();void 0");
  await wait(() => evaluate("document.querySelector('[data-legacy-tool-details] select')?.options.length>1"));
  assert.ok(await evaluate(`(() => {
    const tab=Array.from(document.querySelectorAll('[role=tab]')).find(n=>/^(Tool-call details|工具调用详情)$/.test(n.textContent));
    const rail=tab.closest('[role=tablist]');
    const t=tab.getBoundingClientRect(), r=rail.getBoundingClientRect();
    return t.left>=r.left-1 && t.right<=r.right+1;
  })()`), 'selected detail tab must be visible inside its own horizontal rail');
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
  if (live) {
    const sessionId = await evaluate('window.__compatSessionId');
    await writeFile(path.join(profile,'legacy-live-session'),sessionId);
    await writeFile(path.join(profile,'legacy-live-start'),'start');
    await wait(() => evaluate("Array.from(document.querySelector('[data-legacy-tool-details] select')?.options??[]).some(option=>option.value==='legacy-live-child')"));
    const select = async id => {
      await evaluate(`(() => { const select=document.querySelector('[data-legacy-tool-details] select'); select.value=${JSON.stringify(id)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await wait(() => evaluate(`window.__legacyOwner?.block.callId===${JSON.stringify(id)}`));
    };
    await select('legacy-live-parent');
    assert.equal(await evaluate("document.querySelector('[data-legacy-probe]').getAttribute('data-legacy-state')"),'running');
    await select('legacy-live-child');
    assert.equal(await evaluate("document.querySelector('[data-legacy-probe]').getAttribute('data-legacy-state')"),'running');
    await writeFile(path.join(profile,'legacy-live-child-done'),'complete child');
    await wait(() => evaluate("window.__legacyOwner.block.callId==='legacy-live-child' && document.querySelector('[data-legacy-probe]')?.getAttribute('data-legacy-state')==='settled'"));
    assert.ok(await evaluate("window.__legacyOwner.block.content.some(item=>item.type==='text'&&item.text==='LEGACY_CHILD_RESULT')"), 'selected child must receive the real completed output');
    assert.ok(await evaluate("window.__probeCtx.sessions.binding(window.__compatSessionId).session.getSnapshot().runningCalls.some(call=>call.callId==='legacy-live-parent')"), 'parent remains running when its child finishes');
    await select('legacy-live-parent');
    await writeFile(path.join(profile,'legacy-live-done'),'complete parent');
    await wait(() => evaluate("window.__legacyOwner.block.callId==='legacy-live-parent' && document.querySelector('[data-legacy-probe]')?.getAttribute('data-legacy-state')==='settled'"));
    assert.ok(await evaluate("window.__legacyOwner.block.content.some(item=>item.type==='text'&&item.text==='LEGACY_PARENT_RESULT')"));
    await select('legacy-live-child');
    assert.ok(await evaluate(`(() => {
      const parent=window.__probeCtx.sessions.binding(window.__compatSessionId).session.getSnapshot().nodes.find(node=>node.kind==='tool-result'&&node.callId==='legacy-live-parent');
      return parent.subCalls.find(child=>child.callId==='legacy-live-child')===window.__legacyOwner.block;
    })()`), 'nested selection must retain the exact child slice after its parent settles');
    console.log('Legacy details live parent/child running-to-settled transitions passed through actual Host events with selected call identity preserved.');
  }
  await writeFile(path.join(tmpdir(),'amiba-legacy-tool-details.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const originalSession = await evaluate('window.__compatSessionId');
  const originalCall = await evaluate('window.__legacyOwner.block.callId');
  const otherSession = await evaluate(`(async () => {
    const id=await window.__probeCtx.sessions.create({cwd:window.__legacyOwner.cwd});
    window.__probeCtx.sessions.open(id);
    return id;
  })()`);
  await wait(() => evaluate(`window.__probeCtx.sessions.list.getSnapshot().current===${JSON.stringify(otherSession)} && !document.querySelector('[data-legacy-probe]')`));
  await evaluate("window.__probeCtx.layout.openDetails();void 0");
  await wait(() => evaluate("Array.from(document.querySelectorAll('[role=tab]')).some(n=>/^(Tool-call details|工具调用详情)$/.test(n.textContent))"));
  await evaluate("Array.from(document.querySelectorAll('[role=tab]')).find(n=>/^(Tool-call details|工具调用详情)$/.test(n.textContent)).click();void 0");
  await wait(() => evaluate("!!document.querySelector('[data-legacy-tool-details] select')"));
  assert.equal(await evaluate("document.querySelector('[data-legacy-tool-details] select').value"),'', 'another session must not inherit the first selected call');
  assert.ok(await evaluate("!document.querySelector('[data-legacy-probe]')"), 'no stale selected body in the other session');
  await evaluate(`window.__probeCtx.sessions.open(${JSON.stringify(originalSession)});void 0`);
  await wait(() => evaluate(`document.querySelector('[data-legacy-probe]')?.getAttribute('data-legacy-probe')===${JSON.stringify(originalSession)} && document.querySelector('[data-legacy-tool-details] select')?.value===${JSON.stringify(originalCall)}`));
  await evaluate("window.__legacyOff();void 0");
  await wait(() => evaluate("!document.querySelector('[data-legacy-tool-details]') && document.querySelector('[data-workspace-file-preview]')?.textContent===window.__legacyBeforeFile"));
  assert.equal(await evaluate("document.querySelector('[data-workspace-file-preview]').textContent"),await evaluate('window.__legacyBeforeFile'), 'unload must restore the previous file preview');
  console.log('Legacy tool details passed public layout open/close, real selected Host slice, visible selected tab, session-local selection, retained native title and restoration of the original file preview after unload.');
}
