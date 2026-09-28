#!/usr/bin/env node
// Opt-in diagnostic for an already-running, foreground Electron dev window.
// Start dev with REMOTE_DEBUGGING_PORT=19376 pnpm dev:desktop.
// Never sends a message. Restores the editor state in finally; no conversation
// contents are written to the report. Do not type or switch sessions mid-run.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const WebSocket = require('ws');
const args = process.argv.slice(2);
const flag = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const port = Number(flag('--port', '19376'));
const samples = Number(flag('--samples', '50'));
const output = flag('--out', null);
const background = args.includes('--background');
const scenario = flag('--scenario', 'typing');
if (!args.includes('--run')) throw Error('Pass --run to type temporary characters in the current editor (draft restored; no submit).');
if (!Number.isInteger(samples) || samples < 1 || samples > 500) throw Error('samples must be 1..500');
if (!['typing', 'ime', 'multiline', 'bulk'].includes(scenario)) throw Error('scenario must be typing, ime, multiline, or bulk');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = targets.filter(t => t.type === 'page' && !/quick-ask|devtools:/.test(t.url));
if (pages.length !== 1) throw Error('Expected exactly one main window on this debug port.');
const socket = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let seq = 0;
const pending = new Map();
socket.on('message', bytes => {
  const message = JSON.parse(String(bytes));
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result);
});
socket.on('close', () => { for (const request of pending.values()) request.reject(Error('Debugger disconnected')); pending.clear(); });
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timed out: ${method}`)); }, 15000);
  pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const metrics = async () => Object.fromEntries((await call('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
const stats = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
};
let saved = false;
let interrupted = false;
const stop = () => { interrupted = true; };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  const physicalVisibility = await evaluate('document.visibilityState');
  // Explicit backend validation only: this keeps RAF/ResizeObserver alive on
  // a locked machine, but cannot measure what was presented on the screen.
  if (background) await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  const context = await evaluate(`(() => {
    if (document.visibilityState !== 'visible') throw Error('Main window must be visible; hidden-window timing is not a typing baseline.');
    if (window.__amibaTypingProbe) throw Error('Another typing probe is already active.');
    const roots = [...document.querySelectorAll('[data-auto-grow-editor]')].filter(e => e.getBoundingClientRect().width > 0);
    if (roots.length !== 1 || !roots[0].isContentEditable) throw Error('Expected one editable composer.');
    const root = roots[0], editor = root.__lexicalEditor;
    if (!editor) throw Error('Lexical editor unavailable.');
    const probe = window.__amibaTypingProbe = {root, editor, state: editor.getEditorState(), clones: 0, frames: [], raf: 0, originalClone: Node.prototype.cloneNode};
    Node.prototype.cloneNode = function(...args) { if (this === root) probe.clones++; return probe.originalClone.apply(this, args); };
    root.focus();
    const selection = getSelection(), range = document.createRange();
    range.selectNodeContents(root); range.collapse(false); selection.removeAllRanges(); selection.addRange(range);
    return { mountedTurns: document.querySelectorAll('[data-conversation-user-turn]').length, domNodes: document.querySelectorAll('*').length, visibility: document.visibilityState };
  })()`);
  saved = true;
  await call('Performance.enable');
  await new Promise(r => setTimeout(r, 300));
  await evaluate(`(() => {const p=window.__amibaTypingProbe;let last;const frame=t=>{if(last!==undefined)p.frames.push(t-last);last=t;p.raf=requestAnimationFrame(frame)};p.raf=requestAnimationFrame(frame);p.clones=0;})()`);
  const before = await metrics();
  const keys = [];
  for (let i = 0; i < samples; i++) {
    if (interrupted) throw Error('Typing probe interrupted; restoring draft.');
    const start = performance.now();
    if (scenario === 'typing') {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', unmodifiedText: 'a', windowsVirtualKeyCode: 65 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    } else if (scenario === 'ime') {
      await call('Input.imeSetComposition', { text: '性能测试', selectionStart: 4, selectionEnd: 4 });
      await call('Input.insertText', { text: '性能测试' });
    } else {
      // Insert text without Enter, so neither multiline nor bulk can submit.
      await call('Input.insertText', { text: scenario === 'multiline' ? '性能测试\n' : '批量输入测试 '.repeat(80) });
    }
    keys.push(performance.now() - start);
    await new Promise(r => setTimeout(r, 40));
  }
  const after = await metrics();
  const observed = await evaluate(`(() => {const p=window.__amibaTypingProbe;cancelAnimationFrame(p.raf);if(document.visibilityState!=='visible'||document.querySelector('[data-auto-grow-editor]')!==p.root)throw Error('Window/session changed during measurement');return {clones:p.clones,frames:p.frames}})()`);
  const report = { context: { ...context, mode: background ? 'background-focus-emulation' : 'foreground', visibilityBeforeEmulation: physicalVisibility }, scenario, samples,
    inputDispatchRoundTripMs: stats(keys), ...(scenario === 'typing' ? { keyDispatchRoundTripMs: stats(keys) } : {}),
    ...(background ? { scheduledFrameIntervalsMs: stats(observed.frames) } : { frameIntervalsMs: stats(observed.frames) }), editorClones: observed.clones,
    metrics: Object.fromEntries(Object.keys(after).filter(k => /Duration|Count/.test(k)).map(k => [k, after[k] - before[k]])) };
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (saved) await evaluate(`(() => {const p=window.__amibaTypingProbe;if(!p)return;cancelAnimationFrame(p.raf);Node.prototype.cloneNode=p.originalClone;p.editor.setEditorState(p.state,{tag:'historic'});delete window.__amibaTypingProbe;})()`).catch(error => { console.error('DRAFT RESTORE FAILED:', error.message); process.exitCode = 1; });
  if (background) await call('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
  socket.close();
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
