import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stageRuntime, packageExclusions, verifyPackageContents } from './package-content.mjs';
import { productVersion } from './version.mjs';
import { sourceIdentity } from './provenance.mjs';
import { preflightRelease } from './release-policy.mjs';
import { recordArtifacts, metadataName } from './artifacts.mjs';
import { releaseSettings, targets } from './config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const desktop = path.join(root, 'apps/desktop');
const target = process.argv[2] || `${process.platform}-${process.arch}`;
const localOnly = process.argv.includes('--local-only');
const allowUnsigned = process.argv.includes('--allow-unsigned');
if (allowUnsigned && target !== 'win32-x64') throw new Error('--allow-unsigned is supported for Windows releases. macOS automatic installation requires signing; use --local-only for an unsigned test package.');
if (!targets.includes(target)) throw new Error(`Unsupported target: ${target}`);
if (localOnly && process.argv.includes('--upload')) throw new Error('Local test packages cannot be uploaded as releases');
const settings = localOnly
  ? { sources: [], channel: `latest-${target.split('-')[1]}` }
  : releaseSettings(process.env, target);
if (target !== `${process.platform}-${process.arch}`) throw new Error(`Build ${target} using matching OS/Node architecture. Bundled Node and native modules require a matching host. On Apple Silicon use an isolated x64 checkout with Rosetta and x64 Node; for Windows use Windows x64 or a VM.`);
const run = (args, cwd = root) => {
  const cli = process.env.npm_execpath;
  if (!cli || !/pnpm\.(c?js)$/.test(cli)) throw new Error('Run this command through pnpm release:build');
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed (${result.status})`);
};
const version = productVersion();
const identity = sourceIdentity(localOnly ? 'test' : 'release');
if (!localOnly) preflightRelease(settings.repo, version, identity.sourceCommit);
run(['--dir', 'apps/desktop', 'build']);
const marker = JSON.parse(fs.readFileSync(path.join(root, 'packages/app-runtime/resources/dsh-runtime/runtime-manifest.json')));
if (`${marker.platform}-${marker.arch}` !== target) throw new Error('Bundled runtime target mismatch');
const output = path.join(desktop, 'dist', target);
fs.mkdirSync(output, { recursive: true });
const stagedRuntime = path.join(output, '.package-resources', 'dsh-runtime');
const footprint = await stageRuntime(path.join(root, 'packages/app-runtime/resources/dsh-runtime'), stagedRuntime, target);
console.log('Runtime staging:', JSON.stringify(footprint));
const sourceFile = path.join(output, 'release-config.json');
fs.writeFileSync(sourceFile, JSON.stringify({ sources: settings.sources }, null, 2));
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json')));
const config = {
  ...pkg.build,
  directories: { output },
  files: [...pkg.build.files, ...packageExclusions],
  afterPack: path.join(root, 'scripts/release/verify-package-hook.cjs'),
  forceCodeSigning: !localOnly && !allowUnsigned,
  artifactName: 'Amiba-${version}-${os}-${arch}.${ext}',
  extraResources: [...pkg.build.extraResources.map(resource => resource.to === 'resources/dsh-runtime' ? { ...resource, from: stagedRuntime } : resource), { from: sourceFile, to: 'release-config.json' }],
  // Reserved URL only enables metadata generation for local QA. Embedded sources stay empty.
  publish: [{ provider: 'generic', url: settings.sources[0] || 'https://local-test.invalid/', channel: settings.channel }],
  mac: { ...pkg.build.mac, target: ['dmg', 'zip'], hardenedRuntime: !localOnly, ...(localOnly ? { identity: null } : {}) },
  win: { ...pkg.build.win, target: ['nsis'] },
};
const configFile = path.join(output, 'builder.json');
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
run(['exec', 'node', 'scripts/fix-node-pty-permissions.mjs'], desktop);
// Repeated builds of the same version must not reuse an older updater ZIP.
for (const name of fs.readdirSync(output)) {
  if ((name.startsWith(`Amiba-${version}-`) && /\.(dmg|zip|exe|blockmap)$/.test(name)) || [metadataName(target), 'release-manifest.json', 'package-footprint.json'].includes(name)) fs.rmSync(path.join(output, name), { force: true });
}
run(['exec', 'electron-builder', '--config', configFile, target.startsWith('darwin') ? '--mac' : '--win', `--${process.arch}`, '--publish', 'never'], desktop);
const resources = target.startsWith('darwin')
  ? path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Amiba.app/Contents/Resources')
  : path.join(output, 'win-unpacked/resources');
const packaged = verifyPackageContents(resources, target);
fs.writeFileSync(path.join(output, 'package-footprint.json'), JSON.stringify({ target, version, ...identity, staging: footprint, packaged }, null, 2));
console.log('Package footprint:', JSON.stringify({ asarBytes: packaged.asarBytes, runtimeBytes: packaged.runtimeBytes }));
recordArtifacts(output, target, pkg.version, !localOnly, identity);
console.log(`Artifacts: ${output}`);
if (process.argv.includes('--upload')) run(['release:upload', target]);
