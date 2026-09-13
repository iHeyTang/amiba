import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pdfImageFixture } from './pdf-image-fixture.mjs';
import { pdfFixture } from './pdf-document-fixture.mjs';
export async function smokePdfDocument({ evaluate, wait, fileWorkspace, screenshot }) {
  const file = path.join(fileWorkspace, '.cache/compat-document.pdf');
  try {
    await writeFile(file, pdfFixture());
    await evaluate(`(()=>{window.__pdfWorkers=[];window.__pdfAssetReplies=[];window.__pdfWorkerOriginal=Worker;window.Worker=class extends window.__pdfWorkerOriginal{constructor(url,options){super(url,options);this.__assets=new Map();if(options?.name==='dsh-pdf'){window.__pdfWorkers.push(this);this.addEventListener('message',event=>{if(event.data?.action==='FetchBinaryData')this.__assets.set(event.data.callbackId,event.data.data)})}}postMessage(message,...rest){if(message?.callback===1&&this.__assets?.has(message.callbackId))window.__pdfAssetReplies.push({...this.__assets.get(message.callbackId),bytes:message.data?.byteLength});return super.postMessage(message,...rest)}terminate(){this.__terminated=true;return super.terminate()}};window.__sidebarService.openResource('dsh-resource://file/session/'+encodeURIComponent(window.__compatSessionId)+'/.cache/compat-document.pdf')})()`);
    await wait(() => evaluate("document.querySelectorAll('[data-pdf-page] canvas:not([hidden])').length===2"));
    assert.ok(await evaluate("(()=>{const pages=[...document.querySelectorAll('[data-pdf-page] canvas')];const colors=pages.map(canvas=>Array.from(canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data));return colors[0][0]>200 && colors[0][2]<80 && colors[1][2]>200 && colors[1][0]<80 && window.__pdfWorkers.length===1 && !window.__pdfWorkers[0].__terminated})()"));
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await screenshot?.();
    await writeFile(file, 'invalid PDF contents');
    await wait(() => evaluate("!!document.querySelector('[data-textpreview-changed]')"));
    await evaluate("document.querySelector('[data-textpreview-reload-now]').click()");
    await wait(() => evaluate("!!document.querySelector('[data-textpreview-body] [role=alert]') && window.__pdfWorkers.length===2 && window.__pdfWorkers.every(worker=>worker.__terminated)"));
    await evaluate("document.querySelector('[data-textpreview-body] [role=alert] button').click()");
    await wait(() => evaluate("window.__pdfWorkers.length===3 && window.__pdfWorkers.every(worker=>worker.__terminated)"));
    await writeFile(file, pdfFixture());
    await wait(() => evaluate("!!document.querySelector('[data-textpreview-changed]')"));
    await evaluate("document.querySelector('[data-textpreview-reload-now]').click()");
    await wait(() => evaluate("document.querySelectorAll('[data-pdf-page] canvas:not([hidden])').length===2 && window.__pdfWorkers.length===4"));
    await evaluate("window.__sidebarService.close(window.__sidebarService.active().id)");
    await wait(() => evaluate("!document.querySelector('[data-pdf-preview]') && window.__pdfWorkers.every(worker=>worker.__terminated)"));
    await writeFile(file, pdfFixture(true));
    await evaluate("window.__sidebarService.openResource('dsh-resource://file/session/'+encodeURIComponent(window.__compatSessionId)+'/.cache/compat-document.pdf')");
    await wait(() => evaluate("document.querySelectorAll('[data-pdf-page] canvas:not([hidden])').length===2 && window.__pdfAssetReplies.some(asset=>asset.kind==='standardFontDataUrl' && asset.filename==='FoxitSymbol.pfb' && asset.bytes>1000)"));
    assert.ok(await evaluate("(()=>{const canvas=document.querySelector('[data-pdf-page=\"1\"] canvas');const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<40&&pixels[i+1]<40&&pixels[i+2]<40&&pixels[i+3]>200)dark++;return dark>50})()"), 'Bundled Symbol font must paint dark glyph pixels');
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await screenshot?.();
    await evaluate("window.__sidebarService.close(window.__sidebarService.active().id)");
    await wait(() => evaluate("!document.querySelector('[data-pdf-preview]') && window.__pdfWorkers.every(worker=>worker.__terminated)"));
    await writeFile(file, pdfFixture(false, true));
    await evaluate("window.__sidebarService.openResource('dsh-resource://file/session/'+encodeURIComponent(window.__compatSessionId)+'/.cache/compat-document.pdf')");
    await wait(() => evaluate("document.querySelectorAll('[data-pdf-page] canvas:not([hidden])').length===2 && window.__pdfAssetReplies.some(asset=>asset.kind==='cMapUrl' && asset.filename==='UniJIS-UCS2-H.bcmap' && asset.bytes>1000)"));
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await screenshot?.();
    await evaluate("window.__sidebarService.close(window.__sidebarService.active().id)");
    await wait(() => evaluate("!document.querySelector('[data-pdf-preview]') && window.__pdfWorkers.every(worker=>worker.__terminated)"));
    for (const kind of ['jpeg','jpx','soft-mask']) {
      await writeFile(file, pdfImageFixture(kind));
      const assetStart = await evaluate("window.__pdfAssetReplies.length");
      await evaluate("window.__sidebarService.openResource('dsh-resource://file/session/'+encodeURIComponent(window.__compatSessionId)+'/.cache/compat-document.pdf')");
      await wait(() => evaluate("document.querySelectorAll('[data-pdf-page] canvas:not([hidden])').length===1"));
      const pixels = await evaluate("(()=>{const canvas=document.querySelector('[data-pdf-page] canvas');const context=canvas.getContext('2d');return [0.25,0.75].map(x=>[...context.getImageData(Math.floor(canvas.width*x),Math.floor(canvas.height/2),1,1).data])})()");
      const expected = kind==='soft-mask'?[[128,112,48,255],[32,64,224,255]]:[[224,32,32,255],[32,64,224,255]];
      pixels.forEach((pixel,index)=>assert.ok(pixel.every((channel,c)=>Math.abs(channel-expected[index][c])<=25), `${kind}: actual PDF image pixels ${pixel}`));
      if (kind==='jpx') assert.ok(await evaluate(`window.__pdfAssetReplies.slice(${assetStart}).some(asset=>asset.kind==='wasmUrl' && asset.filename==='openjpeg.wasm' && asset.bytes>1000)`), 'JPEG 2000 must use the real bundled WASM resource');
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      await screenshot?.();
      await evaluate("window.__sidebarService.close(window.__sidebarService.active().id)");
      await wait(() => evaluate("!document.querySelector('[data-pdf-preview]') && window.__pdfWorkers.every(worker=>worker.__terminated)"));
      console.log(`PDF ${kind} image passed actual decode, composited pixel output and Worker termination.`);
    }
    console.log('PDF CMap passed actual UniJIS-UCS2-H.bcmap resource delivery and completed page rendering.');
    console.log('PDF standard font passed actual FoxitSymbol.pfb byte transfer and glyph rasterization in the module Worker path.');
    console.log('PDF document passed real module Worker, two-page red/blue raster output, damaged reload/error/retry cleanup, recovery and worker termination on tab close.');
  } finally {
    await evaluate("if(window.__pdfWorkerOriginal)window.Worker=window.__pdfWorkerOriginal");
    await rm(file, { force: true });
  }
}
