import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedArtifacts, metadataName, publicArtifactNames } from './artifacts.mjs';
import { releaseSettings } from './config.mjs';
import { postArtifact } from './post-upload.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.argv[2] || `${process.platform}-${process.arch}`;
releaseSettings(process.env, target);
const endpoint = process.env.AMIBA_CDN_UPLOAD_URL;
if (!endpoint) throw new Error('CDN POST endpoint is not configured. Set AMIBA_CDN_UPLOAD_URL when the upload API is ready.');
const dir = path.join(root, 'apps/desktop/dist', target);
const version = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'))).version;
const metadata = metadataName(target);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'release-manifest.json')));
const names = publicArtifactNames(manifest, verifiedArtifacts(dir, target, version));
const files = names.filter(name => name !== metadata);
// Commit discovery metadata last, after every referenced package is available.
for (const name of [...files, ...(names.includes(metadata) ? [metadata] : [])]) {
  await postArtifact({
    endpoint, token: process.env.AMIBA_CDN_UPLOAD_TOKEN,
    file: path.join(dir, name), name, version, target,
    sha512: manifest.files.find(file => file.name === name).sha512,
    kind: name === metadata ? 'metadata' : 'artifact',
  });
  console.log(`Uploaded ${name}`);
}
console.log(`Synced ${target}. Refresh CDN metadata cache before release verification.`);
