import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function parseVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Use a stable version: major.minor.patch');
  return version.split('.').map(BigInt);
}
export function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function nextVersion(current, bump) {
  const parts = parseVersion(current);
  const index = ['major', 'minor', 'patch'].indexOf(bump);
  if (index < 0) throw new Error('Choose patch, minor or major');
  parts[index] += 1n;
  for (let i = index + 1; i < 3; i++) parts[i] = 0n;
  return parts.join('.');
}
export function productVersion(directory = root) {
  const version = JSON.parse(fs.readFileSync(path.join(directory, 'apps/desktop/package.json'))).version;
  parseVersion(version);
  if (JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).version !== version) throw new Error('Root and desktop versions differ; use pnpm release:version');
  return version;
}
export function bumpVersion(bump, directory = root) {
  const version = nextVersion(productVersion(directory), bump);
  for (const file of ['package.json', 'apps/desktop/package.json']) {
    const target = path.join(directory, file);
    const pkg = JSON.parse(fs.readFileSync(target));
    pkg.version = version;
    fs.writeFileSync(target, JSON.stringify(pkg, null, 2) + '\n');
  }
  return version;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(process.argv[2] === '--check' ? productVersion() : bumpVersion(process.argv[2]));
}
