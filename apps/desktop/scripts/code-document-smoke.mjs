import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
export async function smokeCodeDocument({ evaluate, wait, fileWorkspace, screenshot }) {
  const file = path.join(fileWorkspace, '.cache/compat-code.ts');
  try {
    await writeFile(file, Array.from({ length: 6002 }, (_, i) => `const value${i + 1}: number = ${i + 1};`).join('\n'));
    await evaluate("window.__codeAddress='dsh-resource://file/session/'+encodeURIComponent(window.__compatSessionId)+'/.cache/compat-code.ts';window.__sidebarService.openResource(window.__codeAddress)");
    await wait(() => evaluate("document.querySelectorAll('[data-code-preview] pre.shiki .line').length===5000"));
    assert.ok(await evaluate("(()=>{const root=document.querySelector('[data-code-preview]');window.__codeFirstLine=root.querySelector('pre .line');window.__codeScroll=root.querySelector('[data-code-block-content]');const token=root.querySelector('pre .line span[style]');return root.querySelector('[data-line-numbers=true]') && token && getComputedStyle(token).color!==getComputedStyle(root.querySelector('pre')).color && window.__codeScroll.getBoundingClientRect().height>100})()"));
    await evaluate("window.__sidebarService.openResource(window.__codeAddress,{params:{line:5002}})");
    await wait(() => evaluate("document.querySelectorAll('[data-code-preview] pre .line').length===6002 && window.__codeScroll.scrollTop>0"));
    assert.ok(await evaluate("document.querySelector('[data-code-preview] pre .line')===window.__codeFirstLine && document.querySelector('[data-code-block-content]')===window.__codeScroll"));
    await evaluate("document.querySelector('[data-textpreview-tool=wrap]').click()");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-code-preview] pre .line')).whiteSpace"), 'pre');
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await screenshot?.();
    await evaluate("window.__sidebarService.close(window.__sidebarService.active().id)");
    await wait(() => evaluate("!document.querySelector('[data-code-preview]')"));
    console.log('Code document passed actual TypeScript highlighting/colors, numbered lines, 5000-line paging, retained completed-line DOM/scrollport, line navigation, wrap and tab close.');
  } finally { await rm(file, { force: true }); }
}
