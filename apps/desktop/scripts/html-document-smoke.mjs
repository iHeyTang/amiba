import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
export async function smokeHtmlDocument({ evaluate, wait, fileWorkspace, screenshot }) {
  const directory = path.join(fileWorkspace, '.cache/compat-html');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, 'main.css'), 'body{font:16px sans-serif;padding:24px}#result{color:rgb(124,58,237)}');
    await writeFile(path.join(directory, 'app.js'), `window.addEventListener('load',()=>{document.querySelector('#result').textContent='HTML_ASSETS_READY';let isolated=false;try{void parent.document.body}catch{isolated=true}parent.postMessage({compatHTML:true,text:document.querySelector('#result').textContent,color:getComputedStyle(document.querySelector('#result')).color,isolated},'*')});`);
    await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="./main.css?v=1"><script defer src="./app.js#entry"></script></head><body><h1 id="result">Loading HTML</h1><p>Local stylesheet and script document preview</p></body></html>');
    await evaluate(`(()=>{window.__htmlRevoked=[];window.__htmlRevokeOriginal=URL.revokeObjectURL;URL.revokeObjectURL=url=>{window.__htmlRevoked.push(url);window.__htmlRevokeOriginal.call(URL,url)};window.__htmlMessage=null;window.__htmlListener=event=>{if(event.source===document.querySelector('[data-html-preview]')?.contentWindow&&event.data?.compatHTML)window.__htmlMessage={...event.data,origin:event.origin}};window.addEventListener('message',window.__htmlListener);window.__sidebarService.openResource('dsh-resource://file/session/'+encodeURIComponent(window.__compatSessionId)+'/.cache/compat-html/index.html')})()`);
    await wait(() => evaluate("window.__htmlMessage?.text==='HTML_ASSETS_READY'"));
    assert.ok(await evaluate("window.__htmlMessage.isolated && window.__htmlMessage.origin==='null' && window.__htmlMessage.color==='rgb(124, 58, 237)'"));
    assert.ok(await evaluate("(()=>{const frame=document.querySelector('[data-html-preview]');window.__htmlUrl=frame.src;return frame.getAttribute('sandbox')==='allow-scripts' && frame.getBoundingClientRect().height>200})()"));
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,100))))");
    await screenshot?.();
    await writeFile(path.join(directory, 'index.html'), Buffer.from([255]));
    await wait(() => evaluate("!!document.querySelector('[data-textpreview-changed]')"));
    await evaluate("document.querySelector('[data-textpreview-reload-now]').click()");
    await wait(() => evaluate("!document.querySelector('[data-html-preview]') && !!document.querySelector('[data-textpreview-body] [role=alert]')"));
    assert.ok(await evaluate("window.__htmlRevoked.includes(window.__htmlUrl)"));
    await evaluate("window.__sidebarService.close(window.__sidebarService.active().id);window.removeEventListener('message',window.__htmlListener);URL.revokeObjectURL=window.__htmlRevokeOriginal");
    console.log('HTML document passed actual relative CSS/JS loading, script execution, computed style, opaque parent isolation, body dimensions, invalid UTF-8 reload failure and old frame URL release.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
