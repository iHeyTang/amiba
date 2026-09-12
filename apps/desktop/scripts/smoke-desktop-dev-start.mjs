import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const userData = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'amiba-dev-launch-')));
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const env = { ...process.env, AMIBA_USER_DATA_DIR: userData, AMIBA_DSH_DEV_PORT: String(port) };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, [path.join(root, 'apps/desktop/scripts/dev-desktop.mjs')], {
  cwd: root, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', chunk => logs += chunk);
child.stderr.on('data', chunk => logs += chunk);
try {
  let ready = false;
  for (let i = 0; i < 1200; i++) {
    if (child.exitCode !== null) throw new Error('Desktop development exited: ' + logs.slice(-5000));
    try {
      const endpoint = JSON.parse(await fs.readFile(path.join(userData, 'dsh/home/amiba-desktop-development.json'), 'utf8'));
      const response = await fetch(endpoint.url + '/ping', { method: 'POST', headers: { Authorization: `Bearer ${endpoint.token}` }, body: '{}' });
      if (response.ok && logs.includes('[desktop:hmr] watching ')) { ready = true; break; }
    } catch { /* Runtime preparation or startup is still running. */ }
    await delay(500);
  }
  assert(ready, logs.slice(-5000));
  const profiles = path.join(userData, 'dsh/home/profiles');
  const active = (await fs.readdir(profiles)).find(name => name.startsWith('amiba-desktop-dev-'));
  assert(active, 'author desktop must use a development profile');
  assert.equal(await fs.realpath(path.join(profiles, active, 'node_modules/@amiba/dsh-plugin-pets')), await fs.realpath(path.join(root, 'plugins/dsh-plugin-pets')));
  const normal = JSON.parse(await fs.readFile(path.join(profiles, 'amiba-desktop/package.json'), 'utf8'));
  assert(!normal.dependencies['@amiba/dsh-plugin-pets']);
  console.log('One desktop dev command starts build watching and the linked DSH development profile; installed profile stays isolated — passed.');
} finally {
  if (child.pid) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
    if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  }
  await fs.rm(userData, { recursive: true, force: true });
}
