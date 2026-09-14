import { readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const archive = process.argv[2];
assert.ok(archive, 'Pass the packed plugin archive');
const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const client = execFileSync('tar', ['-xOf', archive, 'package/lib/client.js'], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
let assets = 0, licenses = 0;
for (const name of ['LICENSE', ...['cmaps', 'standard_fonts', 'wasm'].flatMap(folder => readdirSync(`${root}/${folder}`).map(name => `${folder}/${name}`))]) {
  const bytes = readFileSync(`${root}/${name}`);
  if (name.split('/').at(-1).startsWith('LICENSE')) {
    assert.ok(client.includes(bytes.toString('utf8').trimEnd().replace(/\*\//g, '* /')), `Missing license ${name}`);
    licenses++;
  } else {
    assert.ok(client.includes(bytes.toString('base64')), `Missing PDF asset ${name}`);
    assets++;
  }
}
console.log(`Packed client retains ${licenses} PDF.js license notices and ${assets} binary assets.`);
