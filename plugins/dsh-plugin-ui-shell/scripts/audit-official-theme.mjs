/** Development audit for the pnpm workspace's installed official UI packages.
 * Run after DSH upgrades. Checks token coverage, not rendered appearance. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const store = join(root, 'node_modules/.pnpm');
const bridge = readFileSync(new URL('../src/client/official-theme.css', import.meta.url), 'utf8');
const definitions = text => new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
const provided = definitions(bridge);
const missing = new Map();
const used = new Set();
let files = 0;
for (const entry of readdirSync(store)) {
  if (!entry.startsWith('@deepseek-ai+dsh-client-ui-') || entry.startsWith('@deepseek-ai+dsh-client-ui-theme@')) continue;
  const name = entry.slice(0, entry.indexOf('@', 1)).replace('+', '/');
  const lib = join(store, entry, 'node_modules', name, 'lib');
  if (!existsSync(lib)) continue;
  const paths = name.endsWith('ui-primitives')
    ? readdirSync(lib).filter(f => f.endsWith('.css')).map(f => join(lib, f))
    : [join(lib, 'client.js')].filter(existsSync);
  for (const path of paths) {
    files++;
    const text = readFileSync(path, 'utf8');
    const local = definitions(text);
    for (const [, token] of text.matchAll(/var\((--dsw-[\w-]+)/g)) {
      used.add(token);
      if (!provided.has(token) && !local.has(token)) missing.set(token, name);
    }
  }
}
if (files === 0) throw new Error('No official UI packages found; install workspace dependencies first.');
for (const [token, owner] of missing) console.error(`${token}: ${owner}`);
console.log(`${files} installed UI assets, ${used.size} referenced DSH tokens, ${missing.size} missing bridge tokens.`);
if (missing.size) process.exitCode = 1;
