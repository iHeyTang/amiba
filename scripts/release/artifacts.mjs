import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { createHash } from 'node:crypto';
export function metadataName(target) {
  return `latest-${target.split('-')[1]}${target.startsWith('darwin') ? '-mac' : ''}.yml`;
}
function digest(file) {
  return createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}
export function validateMetadata(dir, target, version) {
  const info = parse(fs.readFileSync(path.join(dir, metadataName(target)), 'utf8'));
  if (info?.version !== version || !Array.isArray(info.files) || !info.files.length) throw new Error('Update metadata version/files mismatch');
  const architecture = target.split('-')[1];
  const osName = target.startsWith('darwin') ? 'mac' : 'win';
  const required = target.startsWith('darwin') ? '.zip' : '.exe';
  for (const entry of info.files) {
    const name = entry.url;
    if (typeof name !== 'string' || name !== path.basename(name) || name.includes('\\') || !name.startsWith(`Amiba-${version}-${osName}-${architecture}.`)) throw new Error('Update metadata references a foreign artifact');
    const file = path.join(dir, name);
    if (entry.sha512 !== digest(file) || (entry.size !== undefined && entry.size !== fs.statSync(file).size)) throw new Error(`Update metadata integrity mismatch: ${name}`);
  }
  if (!info.files.some(entry => entry.url.endsWith(required))) throw new Error(`Update metadata requires ${required}`);
  if (info.path !== undefined) {
    const entry = info.files.find(entry => entry.url === info.path);
    if (!entry || info.sha512 !== entry.sha512) throw new Error('Legacy update metadata mismatch');
  }
  return info;
}
export function recordArtifacts(dir, target, version, distributable = true) {
  validateMetadata(dir, target, version);
  const metadata = metadataName(target);
  const files = fs.readdirSync(dir).filter(name => name.startsWith(`Amiba-${version}-`) && /\.(dmg|zip|exe|blockmap)$/.test(name));
  for (const extension of target.startsWith('darwin') ? ['.dmg', '.zip'] : ['.exe']) {
    if (!files.some(name => name.endsWith(extension))) throw new Error(`Missing ${extension} installer`);
  }
  files.push(metadata);
  const manifest = { target, version, distributable, files: files.map(name => ({ name, sha512: digest(path.join(dir, name)) })) };
  fs.writeFileSync(path.join(dir, 'release-manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
export function verifiedArtifacts(dir, target, version) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'release-manifest.json'), 'utf8'));
  if (manifest.distributable !== true) throw new Error('Local test packages cannot be uploaded as releases');
  if (manifest.target !== target || manifest.version !== version) throw new Error('Rebuild: artifact manifest target/version mismatch');
  if (!Array.isArray(manifest.files) || !manifest.files.some(f => f.name === metadataName(target))) throw new Error('Update metadata missing');
  const files = manifest.files.map(({ name, sha512 }) => {
    if (typeof name !== 'string' || name !== path.basename(name) || name.includes('\\')) throw new Error('Invalid artifact path');
    if (digest(path.join(dir, name)) !== sha512) throw new Error(`Artifact changed after build: ${name}`);
    return name;
  });
  for (const extension of target.startsWith('darwin') ? ['.dmg', '.zip'] : ['.exe']) {
    if (!files.some(name => name.startsWith(`Amiba-${version}-`) && name.endsWith(extension))) throw new Error(`Missing ${extension} installer`);
  }
  validateMetadata(dir, target, version);
  return files;
}
