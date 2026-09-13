import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
export async function smokeDocumentPreview({ evaluate, wait, fileWorkspace, screenshot }) {
  const relative = '.cache/compat-document-preview.txt';
  const file = path.join(fileWorkspace, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Array.from({ length: 6002 }, (_, i) => `DOCUMENT_LINE_${i + 1}`).join('\n'));
  try {
    await evaluate(`(async()=>{
      window.__documentFiber=await window.__probeCtx.inject(['sidebarRight','documentPreviews'], child=>{window.__documentCtx=child});
      window.__documentAddress='dsh-resource://file/session/'+encodeURIComponent(window.__compatSessionId)+'/'+${JSON.stringify(relative)};
      window.__documentCtx.sidebarRight.openResource(window.__documentAddress);
    })()`);
    await wait(() => evaluate("document.querySelector('[data-textpreview-line=\"1\"]')?.textContent.includes('DOCUMENT_LINE_1')"));
    assert.ok(await evaluate("document.querySelector('[data-textpreview-page=\"1\"]') && !document.querySelector('[data-textpreview-page=\"5001\"]')"));
    await evaluate("window.__documentCtx.sidebarRight.openResource(window.__documentAddress,{params:{line:5002}})");
    await wait(() => evaluate("document.querySelector('[data-textpreview-target=\"5002\"]')?.textContent.includes('DOCUMENT_LINE_5002')"));
    assert.ok(await evaluate("document.querySelector('[data-textpreview-line=\"6002\"]')?.textContent.includes('DOCUMENT_LINE_6002')"));
    assert.ok(await evaluate("document.querySelector('[data-textpreview-body]').getBoundingClientRect().height>100"));
    await writeFile(file, 'DOCUMENT_UPDATED\nsecond');
    await wait(() => evaluate("!!document.querySelector('[data-textpreview-changed]')"));
    await evaluate("document.querySelector('[data-textpreview-reload-now]').click()");
    await wait(() => evaluate("document.querySelector('[data-textpreview-line=\"1\"]')?.textContent.includes('DOCUMENT_UPDATED')"));
    await screenshot?.();
    await evaluate(`(()=>{
      const child=window.__documentCtx,h=window.__probeCreateElement;
      child.effect(()=>child.documentPreviews.register({id:'compat/document-bytes',extensions:['txt'],title:()=> 'Compat bytes',loading:'bytes-complete'}));
      child.effect(()=>child.slots.register({name:'sidebar.right.tab.document',key:'compat/document-bytes'},props=>{
        const info=props.useTabInfo();window.__documentInfo=info;window.__documentOwner=props;
        return h('output',{'data-document-custom':''},props.content.kind==='bytes'?new TextDecoder().decode(props.content.data):'WRONG_MODE');
      }));
    })()`);
    await wait(() => evaluate("document.querySelector('[data-document-custom]')?.textContent==='DOCUMENT_UPDATED\\nsecond'"));
    assert.ok(await evaluate("window.__documentOwner.resourceAddress===window.__documentAddress && typeof window.__documentOwner.scrollportRef==='function' && window.__documentInfo.tab.navigation.params.line===5002 && window.__documentInfo.tab.visible"));
    await evaluate("window.__documentSavedSignal=window.__documentInfo.tab.signal;window.__documentSavedId=window.__documentInfo.tab.id;window.__documentFiber.dispose()");
    await wait(() => evaluate("!document.querySelector('[data-document-custom]') && document.querySelector('[data-textpreview-line=\"1\"]')?.textContent.includes('DOCUMENT_UPDATED')"));
    await evaluate("window.__sidebarService.close(window.__documentSavedId)");
    await wait(() => evaluate("window.__documentSavedSignal.aborted && !document.querySelector('[data-textpreview-body]')"));
    await evaluate("if(window.__sidebarService.isExpanded())window.__sidebarService.toggleExpanded()");
    console.log('Document preview passed actual resource opening, 5000-line paging/navigation, metadata change/reload, measured body, third-party byte renderer owner/hooks, unload-to-plain fallback and tab cancellation.');
  } finally { await rm(file, { force: true }); }
}
