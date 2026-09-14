import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { releaseSettings } from './config.mjs';
import { verifiedArtifacts, publicArtifactNames } from './artifacts.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.argv[2] || `${process.platform}-${process.arch}`;
const { sources } = releaseSettings(process.env, target);
const dir = path.join(root, 'apps/desktop/dist', target);
const version = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'))).version;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'release-manifest.json')));
const names = publicArtifactNames(manifest, verifiedArtifacts(dir, target, version));
let failed = false;
for (const source of sources) {
  for (const name of names) {
    try {
      const response = await fetch(new URL(name, source), { signal: AbortSignal.timeout(15 * 60 * 1000), headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const hash = createHash('sha512');
      for await (const chunk of response.body) hash.update(chunk);
      const expected = manifest.files.find(file => file.name === name).sha512;
      if (hash.digest('base64') !== expected) throw new Error('SHA-512 mismatch (stale or altered remote artifact)');
      console.log(`Verified ${new URL(name, source)}`);
    } catch (error) {
      failed = true;
      console.error(`Failed ${new URL(name, source)}: ${error.message}`);
    }
  }
}
if (failed) process.exitCode = 1;
