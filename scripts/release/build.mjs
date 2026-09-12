import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { recordArtifacts } from './artifacts.mjs';
import { releaseSettings } from './config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const desktop = path.join(root, 'apps/desktop');
const target = process.argv[2] || `${process.platform}-${process.arch}`;
const settings = releaseSettings(process.env, target);
if (target !== `${process.platform}-${process.arch}`) throw new Error(`Build ${target} using matching OS/Node architecture. Bundled Node and native modules require a matching host. On Apple Silicon use an isolated x64 checkout with Rosetta and x64 Node; for Windows use Windows x64 or a VM.`);
const run = (args, cwd = root) => {
  const cli = process.env.npm_execpath;
  if (!cli || !/pnpm\.(c?js)$/.test(cli)) throw new Error('Run this command through pnpm release:build');
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed (${result.status})`);
};
run(['--dir', 'apps/desktop', 'build']);
const marker = JSON.parse(fs.readFileSync(path.join(root, 'packages/app-runtime/resources/dsh-runtime/runtime-manifest.json')));
if (`${marker.platform}-${marker.arch}` !== target) throw new Error('Bundled runtime target mismatch');
const output = path.join(desktop, 'dist', target);
fs.mkdirSync(output, { recursive: true });
const sourceFile = path.join(output, 'release-config.json');
fs.writeFileSync(sourceFile, JSON.stringify({ sources: settings.sources }, null, 2));
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json')));
const config = {
  ...pkg.build,
  directories: { output },
  artifactName: 'Amiba-${version}-${os}-${arch}.${ext}',
  extraResources: [...pkg.build.extraResources, { from: sourceFile, to: 'release-config.json' }],
  publish: [{ provider: 'generic', url: settings.sources[0], channel: settings.channel }],
  mac: { ...pkg.build.mac, target: ['dmg', 'zip'], hardenedRuntime: true },
  win: { ...pkg.build.win, target: ['nsis'] },
};
const configFile = path.join(output, 'builder.json');
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
run(['exec', 'node', 'scripts/fix-node-pty-permissions.mjs'], desktop);
run(['exec', 'electron-builder', '--config', configFile, target.startsWith('darwin') ? '--mac' : '--win', `--${process.arch}`, '--publish', 'never'], desktop);
recordArtifacts(output, target, pkg.version);
console.log(`Artifacts: ${output}`);
if (process.argv.includes('--upload')) run(['release:upload', target]);
