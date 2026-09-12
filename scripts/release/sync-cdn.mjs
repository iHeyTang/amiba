import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifiedArtifacts, metadataName } from './artifacts.mjs';
import { releaseSettings } from './config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.argv[2] || `${process.platform}-${process.arch}`;
const { channel } = releaseSettings(process.env, target);
const destination = process.env.AMIBA_CDN_REMOTE;
if (!destination || !destination.includes(':')) throw new Error('Set AMIBA_CDN_REMOTE to a configured rclone remote directory, e.g. cos:amiba/releases/stable');
const dir = path.join(root, 'apps/desktop/dist', target);
const version = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'))).version;
const metadata = metadataName(target);
const files = verifiedArtifacts(dir, target, version).filter(name => name !== metadata);
// Upload installers before the discovery manifest. Never delete older versions.
for (const name of [...files, metadata]) {
  const result = spawnSync('rclone', ['copyto', path.join(dir, name), `${destination.replace(/\/$/, '')}/${name}`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`CDN upload failed: ${name}`);
}
console.log(`Synced ${target} to ${destination}. Purge CDN metadata cache before release verification.`);
