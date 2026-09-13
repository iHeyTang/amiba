import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pdfFixture } from './pdf-document-fixture.mjs';
export async function smokePdfDocument({ evaluate, wait, fileWorkspace, screenshot }) {
  const file = path.join(fileWorkspace, '.cache/compat-document.pdf');
  try {
    await writeFile(file, pdfFixture());
    await evaluate(`(()=>{window.__pdfWorkers=[];window.__pdfWorkerOriginal=Worker;window.Worker=class extends window.__pdfWorkerOriginal{constructor(url,options){super(url,options);if(options?.name==='dsh-pdf')window.__pdfWorkers.push(this)}terminate(){this.__terminated=true;return super.terminate()}};window.__sidebarService.openResource('dsh-resource://file/session/'+encodeURIComponent(window.__compatSessionId)+'/.cache/compat-document.pdf')})()`);
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
    console.log('PDF document passed real module Worker, two-page red/blue raster output, damaged reload/error/retry cleanup, recovery and worker termination on tab close.');
  } finally {
    await evaluate("if(window.__pdfWorkerOriginal)window.Worker=window.__pdfWorkerOriginal");
    await rm(file, { force: true });
  }
}
