// Native Chromium regression for the startup visibility gate. No user profile,
// runtime, model requests or foreground window are needed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
if (!process.versions.electron) {
  const profile = await mkdtemp(path.join(tmpdir(), 'amiba-startup-style-'));
  const env = { ...process.env, AMIBA_STARTUP_STYLE_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const child = spawn(require('electron'), [fileURLToPath(import.meta.url)], { env, stdio: 'inherit' });
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
    try { process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); }); }
    finally { clearTimeout(timer); }
  } finally { await rm(profile, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', process.env.AMIBA_STARTUP_STYLE_PROFILE);
  app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  try {
    const html = (await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const ts = require('typescript');
    const remove = ts.transpileModule(await readFile(new URL('../src/renderer/startup-screen.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    for (const theme of ['light', 'dark']) for (const glass of [false, true]) {
      await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const before = await window.webContents.executeJavaScript(`(() => {
        document.documentElement.classList.add(${JSON.stringify(theme)});
        if (${glass}) document.documentElement.dataset.startupGlass = 'true';
        const root = document.getElementById('root');
        root.innerHTML = '<button style="visibility:visible">Header control</button>';
        return {root:getComputedStyle(root).visibility,child:getComputedStyle(root.firstChild).visibility,opacity:getComputedStyle(root).opacity,height:root.getBoundingClientRect().height,background:getComputedStyle(document.body).backgroundColor};
      })()`);
      assert.equal(before.root, 'hidden');
      assert.equal(before.child, 'hidden', 'explicitly visible controls must not flash during startup');
      assert.equal(before.opacity, '0');
      assert.ok(before.height > 0, 'warmup must retain layout');
      if (glass) assert.equal(before.background, 'rgba(0, 0, 0, 0)');
      const after = await window.webContents.executeJavaScript(`(() => {
        const exports = {}; ${remove}
        exports.removeStartupScreen(); exports.removeStartupScreen();
        const root = document.getElementById('root');
        // Later DOM insertions must no longer control startup visibility.
        const later = document.createElement('div');later.id='amiba-startup';root.append(later);
        return {root:getComputedStyle(root).visibility,child:getComputedStyle(root.firstChild).visibility,opacity:getComputedStyle(root).opacity,pending:document.documentElement.hasAttribute('data-amiba-starting'),background:getComputedStyle(document.body).backgroundColor};
      })()`);
      assert.equal(after.root, 'visible');
      assert.equal(after.child, 'visible');
      assert.equal(after.opacity, '1');
      assert.equal(after.pending, false);
      assert.notEqual(after.background, 'rgba(0, 0, 0, 0)', 'startup-only transparency must be released');
      console.log(`startup gate: ${theme}, glass=${glass} — passed`);
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { window.destroy(); app.exit(process.exitCode ?? 0); }
  }).catch(error => { console.error(error); app.exit(1); });
}
