import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { smokeHtmlDocument } from './html-document-smoke.mjs';
import { smokeCodeDocument } from './code-document-smoke.mjs';
export async function smokeDocumentPreview({ evaluate, wait, fileWorkspace, screenshot }) {
  const relative = '.cache/compat-document-preview.txt';
  const file = path.join(fileWorkspace, relative);
  const markdownFile = path.join(fileWorkspace, '.cache/compat-document-preview.md');
  const imageFile = path.join(fileWorkspace, '.cache/compat-document-preview.svg');
  const rasterFile = path.join(fileWorkspace, '.cache/compat-document-preview.png');
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
    await writeFile(markdownFile, '# DOCUMENT_MARKDOWN\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Document link](https://example.com/)\n\n```js\nconst answer = 42;\n```');
    await evaluate("window.__sidebarService.openResource(window.__documentAddress.replace(/\\.txt$/,'.md'))");
    await wait(() => evaluate("document.querySelector('[data-document-markdown] h1')?.textContent==='DOCUMENT_MARKDOWN' && !!document.querySelector('[data-document-markdown] table')"));
    assert.equal(await evaluate("document.querySelector('[data-document-markdown] a')?.getAttribute('href')"), 'https://example.com/');
    assert.ok(await evaluate("document.querySelector('[data-document-markdown] code')?.textContent.includes('const answer = 42;')"));
    assert.ok(await evaluate(`(()=>{
      const root=document.querySelector('[data-document-markdown]');
      const heading=getComputedStyle(root.querySelector('h1'));
      const link=getComputedStyle(root.querySelector('a'));
      const cell=getComputedStyle(root.querySelector('th'));
      return parseFloat(heading.fontSize)>parseFloat(link.fontSize)
        && !link.fontFamily.includes('monospace')
        && link.color!==getComputedStyle(root).color
        && parseFloat(cell.borderBottomWidth)>0 && cell.borderBottomStyle==='solid'
        && cell.borderBottomColor!=='rgba(0, 0, 0, 0)';
    })()`), 'Markdown document must have prose typography, distinct links and visible table borders');
    await screenshot?.();
    await evaluate("window.__sidebarService.close(window.__sidebarService.active().id)");
    await wait(() => evaluate("!document.querySelector('[data-document-markdown]')"));
    await writeFile(imageFile, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#7c3aed"/><circle cx="200" cy="120" r="65" fill="#ffffff"/></svg>');
    await evaluate("window.__sidebarService.openResource(window.__documentAddress.replace(/\\.txt$/,'.svg'))");
    await wait(() => evaluate("(()=>{const img=document.querySelector('[data-image-preview] img');return img && !img.hidden && img.complete && img.naturalWidth===400})()"));
    assert.ok(await evaluate("(()=>{const img=document.querySelector('[data-image-preview] img');window.__documentImageUrl=img.src;return img.naturalHeight===240 && img.getBoundingClientRect().width===400 && img.getBoundingClientRect().height===240 && img.src.startsWith('blob:')})()"));
    await screenshot?.();
    await writeFile(imageFile, 'invalid image');
    await wait(() => evaluate("!!document.querySelector('[data-textpreview-changed]')"));
    await evaluate("document.querySelector('[data-textpreview-reload-now]').click()");
    await wait(() => evaluate("!!document.querySelector('[data-image-preview] [role=alert]')"));
    assert.ok(await evaluate("new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(false);image.onerror=()=>resolve(true);image.src=window.__documentImageUrl})"), 'Old image Blob URL must be revoked after reload');
    await evaluate("window.__documentImageUrl=document.querySelector('[data-image-preview] img').src;window.__sidebarService.close(window.__sidebarService.active().id)");
    await wait(() => evaluate("!document.querySelector('[data-image-preview]')"));
    await writeFile(rasterFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64'));
    await evaluate("window.__sidebarService.openResource(window.__documentAddress.replace(/\\.txt$/,'.png'))");
    await wait(() => evaluate("(()=>{const img=document.querySelector('[data-image-preview] img');return img && !img.hidden && img.complete && img.naturalWidth===1 && img.naturalHeight===1})()"));
    await evaluate("window.__documentImageUrl=document.querySelector('[data-image-preview] img').src;window.__sidebarService.close(window.__sidebarService.active().id)");
    await wait(() => evaluate("!document.querySelector('[data-image-preview]')"));
    assert.ok(await evaluate("new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(false);image.onerror=()=>resolve(true);image.src=window.__documentImageUrl})"), 'Image Blob URL must be revoked after close');
    await smokeHtmlDocument({ evaluate, wait, fileWorkspace, screenshot });
    await smokeCodeDocument({ evaluate, wait, fileWorkspace, screenshot });
    await evaluate("if(window.__sidebarService.isExpanded())window.__sidebarService.toggleExpanded()");
    console.log('Image document passed real SVG and PNG decoding, intrinsic dimensions, changed-file reload failure, and Blob URL release on replacement and close.');
    console.log('Document preview passed actual resource opening, 5000-line paging/navigation, metadata change/reload, measured body, third-party byte renderer owner/hooks, unload-to-plain fallback, tab cancellation and actual Markdown heading/table/link/code rendering.');
  } finally { await rm(file, { force: true }); await rm(markdownFile, { force: true }); await rm(imageFile, { force: true }); await rm(rasterFile, { force: true }); }
}
