import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildDevelopmentProject } from '@amiba/app-runtime/dsh-runtime';

test('successful host builds publish, failed builds preserve previous output, staging is cleaned', async () => {
  const workspace = await fs.mkdtemp(path.join(tmpdir(), 'amiba-build-test-'));
  const root = path.join(workspace, 'plugins/dsh-plugin-probe');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(workspace, 'packages'));
  await fs.mkdir(path.join(workspace, 'bundles'));
  let watcher;
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'), 'dir');
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'dsh-plugin-probe', main: 'lib/index.js', scripts: { build: 'tsc -p tsconfig.build.json' } }));
    await fs.writeFile(path.join(root, 'tsconfig.build.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', rootDir: 'src', outDir: 'lib', skipLibCheck: true, types: [] }, include: ['src'] }));
    const source = path.join(root, 'src/index.ts');
    const target = path.join(root, 'lib/index.js');
    await fs.writeFile(source, 'export const value: string = "one";');
    await buildDevelopmentProject(root);
    const before = await fs.readFile(target, 'utf8');
    await fs.writeFile(source, 'export const value: string = 42;');
    await assert.rejects(buildDevelopmentProject(root), /build failed/);
    assert.equal(await fs.readFile(target, 'utf8'), before);
    assert(!(await fs.readdir(root)).some(name => name.startsWith('.amiba-build-')));
    await fs.writeFile(source, 'export const value: string = "two";');
    await buildDevelopmentProject(root);
    assert.match(await fs.readFile(target, 'utf8'), /two/);
    let logs = '';
    watcher = spawn(process.execPath, ['--input-type=module', '-e', `import {watchClients} from ${JSON.stringify(new URL('./watch-dsh-clients.mjs', import.meta.url).href)}; await watchClients(${JSON.stringify({ workspaceDir: workspace, fullPlugins: true })})`], {stdio:['ignore','pipe','pipe']});
    watcher.stdout.on('data', chunk => logs += chunk);
    watcher.stderr.on('data', chunk => logs += chunk);
    async function wait(check) { for(let i=0;i<300;i++) { if(await check()) return; await delay(50); } throw new Error(logs); }
    await wait(() => logs.includes('watching 1'));
    await fs.writeFile(source, 'export const value: string = "three";');
    await wait(async () => (await fs.readFile(target, 'utf8')).includes('three'));
    assert(logs.includes('workspace plugins (host/client/native)'));

  } finally { if (watcher?.exitCode === null) { watcher.kill('SIGTERM'); await new Promise(resolve => watcher.once('exit', resolve)); } await fs.rm(workspace, { recursive: true, force: true }); }
});
