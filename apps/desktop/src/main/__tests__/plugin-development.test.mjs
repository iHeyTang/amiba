import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
// Built output of the CLI, which is why `apps/desktop`'s `pretest` builds
// `apps/cli` first — without it this file fails to import on a fresh checkout.
import { discoverDevelopmentEndpoint } from '../../../../cli/dist/lib/development-connection.js';
import { servePluginDevelopment } from '../plugin-development.ts';

test('development endpoint authenticates, serializes leases, and rolls back a rejected attachment', async () => {
  const home = await fs.mkdtemp(path.join(tmpdir(), 'amiba-dev-control-'));
  let server;
  try {
    const project = path.join(home, 'project');
    await fs.mkdir(path.join(project, 'lib'), { recursive: true });
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'dsh-plugin-test', main: 'lib/index.js' }));
    await fs.writeFile(path.join(project, 'lib/index.js'), '');
    const changes = [];
    let reject = true;
    server = await servePluginDevelopment({ home, change: async dirs => { if (reject) throw new Error('fixture rejected'); changes.push(dirs); } });
    const file = path.join(home, 'amiba-desktop-development.json');
    const endpoint = JSON.parse(await fs.readFile(file, 'utf8'));
    const stale = path.join(home, 'old-dev-home');
    await fs.mkdir(stale);
    await fs.writeFile(path.join(stale, 'amiba-desktop-development.json'), JSON.stringify({ ...endpoint, token: 'expired' }));
    assert.deepEqual(await discoverDevelopmentEndpoint([stale, home, home]), endpoint);
    const send = (operation, body, headers = {}) => fetch(endpoint.url + operation, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.token}`, ...headers }, body: JSON.stringify(body) });
    assert.equal((await send('/connect', { directory: project }, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await send('/connect', { directory: project }, { Authorization: 'Bearer wrong' })).status, 403);
    assert.equal((await send('/connect', { directory: project })).status, 400);
    reject = false;
    const response = await send('/connect', { directory: project });
    assert.equal(response.status, 200);
    const { id } = await response.json();
    assert.equal((await send('/connect', { directory: project })).status, 400);
    assert.equal((await send('/heartbeat', { id })).status, 200);
    assert.equal((await send('/disconnect', { id })).status, 200);
    assert.deepEqual(changes, [[await fs.realpath(project)], []]);
    await server.close(); server = undefined;
    await assert.rejects(fs.access(file), { code: 'ENOENT' });
  } finally { await server?.close(); await fs.rm(home, { recursive: true, force: true }); }
});
