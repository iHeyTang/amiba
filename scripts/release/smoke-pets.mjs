// Exercise the packaged static Studio, not the workspace's npm installation.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const runtime = path.resolve(process.argv[2]);
const fromHost = createRequire(path.join(runtime, 'app/package.json'));
assert.throws(() => fromHost.resolve('@mofli/studio'), { code: 'MODULE_NOT_FOUND' });
const { StudioHost } = await import(pathToFileURL(path.join(runtime, 'app/node_modules/@amiba/dsh-plugin-pets/lib/studio.js')).href);
const host = new StudioHost();
try {
  const url = await host.open();
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Mofli Studio/);
  const script = html.match(/src="([^"]+\.js)"/);
  assert.ok(script, 'Studio page must reference its built JavaScript');
  assert.equal((await fetch(new URL(script[1], url))).status, 200);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  console.log('Verified plugin-owned Studio HTML and JavaScript without host Mofli dependencies');
} finally { host.dispose(); }
