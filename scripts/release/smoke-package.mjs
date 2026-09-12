import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateMetadata } from './artifacts.mjs';

const target = process.argv[2];
assert.equal(target, `${process.platform}-${process.arch}`, 'Smoke test requires the target OS and architecture');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'))).version;
const output = path.join(root, 'apps/desktop/dist', target);
validateMetadata(output, target, version);
function run(command, args, env = process.env, timeout = 120000) {
  const result = spawnSync(command, args, { encoding: 'utf8', env, timeout, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
  console.log(result.stdout.trim());
  return result.stdout;
}
let resources;
let electron;
if (process.platform === 'win32') {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Silent installer testing is restricted to disposable CI runners');
  const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Amiba');
  console.log(`Installing into the normal per-user location: ${installDir}`);
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(output, `Amiba-${version}-win-x64.exe`), ['/S', `/D=${installDir}`], { stdio: 'inherit' });
    const started = Date.now();
    const progress = setInterval(() => {
      const entries = fs.existsSync(installDir) ? fs.readdirSync(installDir) : [];
      console.log(`Installer running for ${Math.round((Date.now() - started) / 1000)}s; installed entries: ${entries.join(', ') || '(none)'}`);
    }, 30000);
    const timeout = setTimeout(() => { child.kill(); reject(new Error('NSIS installation exceeded 15 minutes')); }, 900000);
    const cleanup = () => { clearInterval(progress); clearTimeout(timeout); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', code => { cleanup(); code === 0 ? resolve() : reject(new Error(`NSIS installer exited ${code}`)); });
  });
  electron = path.join(installDir, 'Amiba.exe');
  resources = path.join(installDir, 'resources');
  assert.ok(fs.existsSync(electron), 'NSIS must install the application executable');
} else {
  const app = path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Amiba.app');
  electron = path.join(app, 'Contents/MacOS/Amiba');
  resources = path.join(app, 'Contents/Resources');
  run('hdiutil', ['verify', path.join(output, `Amiba-${version}-mac-${process.arch}.dmg`)]);
  run('unzip', ['-tq', path.join(output, `Amiba-${version}-mac-${process.arch}.zip`)], process.env, 300000);
}
const runtime = path.join(resources, 'resources/dsh-runtime');
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'runtime-manifest.json')));
assert.equal(`${manifest.platform}-${manifest.arch}`, target);
const node = path.join(runtime, process.platform === 'win32' ? 'node/node.exe' : 'node/bin/node');
assert.equal(run(node, ['-p', "process.platform + '-' + process.arch"]).trim(), target);
const probe = `
  const assert = require('node:assert/strict');
  assert.equal(process.platform + '-' + process.arch, ${JSON.stringify(target)});
  const pty = require(${JSON.stringify(path.join(resources, 'app.asar/node_modules/node-pty'))});
  const terminal = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/echo', process.platform === 'win32' ? ['/c', 'echo amiba-pty-ok'] : ['amiba-pty-ok'], {cols: 80, rows: 24});
  let output = '';
  const timer = setTimeout(() => { console.error('PTY timed out', output); process.exit(1); }, 15000);
  terminal.onData(data => { output += data; });
  terminal.onExit(({exitCode}) => { clearTimeout(timer); assert.equal(exitCode, 0); assert.match(output, /amiba-pty-ok/); console.log(process.arch + ' amiba-pty-ok'); });
`;
run(electron, ['-e', probe], { ...process.env, ELECTRON_RUN_AS_NODE: '1' });
console.log(`Verified ${target}: installer integrity, packaged Node, Electron native PTY`);
