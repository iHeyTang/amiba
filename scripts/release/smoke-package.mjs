import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPackageContents } from './package-content.mjs';
import { validateMetadata } from './artifacts.mjs';

const target = process.argv[2];
assert.equal(target, `${process.platform}-${process.arch}`, 'Smoke test requires the target OS and architecture');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'))).version;
const output = path.join(root, 'apps/desktop/dist', target);
validateMetadata(output, target, version);
// The installer and update bundle travel separately; verify their shared manifest
// before executing an installer or extracting the application.
const packageManifest = JSON.parse(fs.readFileSync(path.join(output, 'release-manifest.json')));
assert.equal(packageManifest.target, target);
assert.equal(packageManifest.version, version);
for (const { name, sha512 } of packageManifest.files) {
  assert.equal(name, path.basename(name));
  assert.ok(!name.includes('\\'));
  const actual = createHash('sha512').update(fs.readFileSync(path.join(output, name))).digest('base64');
  assert.equal(actual, sha512, `Artifact integrity mismatch: ${name}`);
}

function run(command, args, env = process.env, timeout = 120000) {
  const result = spawnSync(command, args, { encoding: 'utf8', env, timeout, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.status}\n${result.stderr}\n${result.stdout}`);
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
  if (!fs.existsSync(app)) {
    // Verify mode downloads installers only; unpack the already-hash-checked updater ZIP.
    run('ditto', ['-x', '-k', path.join(output, `Amiba-${version}-mac-${process.arch}.zip`), path.dirname(app)], process.env, 300000);
  }
  electron = path.join(app, 'Contents/MacOS/Amiba');
  resources = path.join(app, 'Contents/Resources');
  run('hdiutil', ['verify', path.join(output, `Amiba-${version}-mac-${process.arch}.dmg`)]);
  run('unzip', ['-tq', path.join(output, `Amiba-${version}-mac-${process.arch}.zip`)], process.env, 300000);
}
if (packageManifest.macSigning === 'unsigned' && packageManifest.distributable) {
  assert.equal(packageManifest.autoUpdate, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(resources, 'release-config.json'))).sources, []);
  console.log('Verified unsigned macOS release: automatic updates disabled');
}
// Older artifacts can still be installed in verify mode; new packages must satisfy pruning checks.
if (fs.existsSync(path.join(output, 'package-footprint.json'))) verifyPackageContents(resources, target);
const runtime = path.join(resources, 'resources/dsh-runtime');
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'runtime-manifest.json')));
assert.equal(`${manifest.platform}-${manifest.arch}`, target);
const node = path.join(runtime, process.platform === 'win32' ? 'node/node.exe' : 'node/bin/node');
assert.equal(run(node, ['-p', "process.platform + '-' + process.arch"]).trim(), target);
run(node, [path.join(root, 'scripts/release/smoke-memory.cjs'), runtime], process.env, 120000);
const probe = `
  const assert = require('node:assert/strict');
  assert.equal(process.platform + '-' + process.arch, ${JSON.stringify(target)});
  const timer = setTimeout(() => { console.error('PTY timed out'); process.exit(1); }, 15000);
  console.log('Loading packaged PTY');
  const pty = require(${JSON.stringify(path.join(resources, 'app.asar/node_modules/node-pty'))});
  console.log('Spawning packaged PTY');
  const terminal = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/echo', process.platform === 'win32' ? ['/c', 'echo amiba-pty-ok'] : ['amiba-pty-ok'], {cols: 80, rows: 24});
  let output = '';
  console.log('PTY spawned');
  terminal.onData(data => { output += data; });
  terminal.onExit(({exitCode}) => { clearTimeout(timer); assert.equal(exitCode, 0); assert.match(output, /amiba-pty-ok/); console.log(process.arch + ' amiba-pty-ok'); process.exit(0); });
`;
const probeFile = path.join(output, 'installer-pty-probe.cjs');
fs.writeFileSync(probeFile, probe);
try {
  run(electron, [probeFile], { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, 45000);
} catch (error) {
  fs.writeFileSync(path.join(output, 'installer-pty-error.txt'), error.stack);
  throw error;
}
console.log(`Verified ${target}: installer integrity, packaged Node, Electron native PTY`);
