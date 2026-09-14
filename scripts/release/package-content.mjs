import fs from 'node:fs';
import path from 'node:path';
import { targets } from './config.mjs';

export const packageExclusions = [
  '!**/.cache{,/**/*}',
  '!**/_cacache{,/**/*}',
  // Workspace symlinks are matched against their real source paths by builder 25.
  '!**/resources/dsh-runtime{,/**/*}',
  '!**/*.{js,mjs,cjs,css,ts,tsx}.map',
];
export function isSourceMap(name) { return /\.(?:[cm]?js|css|tsx?)\.map$/.test(name); }
export function exclusionReason(relative, target) {
  if (!targets.includes(target)) throw new Error('Invalid package target');
  const parts = relative.replaceAll('\\', '/').split('/');
  if (parts.includes('.cache') || parts.includes('_cacache')) return 'build-cache';
  if (isSourceMap(relative)) return 'source-map';
  // onnxruntime-node loads exactly bin/napi-v6/<platform>/<arch> at runtime.
  const index = parts.indexOf('onnxruntime-node');
  if (index >= 0 && parts[index + 1] === 'bin' && /^napi-v\d+$/.test(parts[index + 2] || '')) {
    const [platform, arch] = target.split('-');
    if (parts[index + 3] && parts[index + 3] !== platform) return 'foreign-onnx-binary';
    if (parts[index + 4] && parts[index + 4] !== arch) return 'foreign-onnx-binary';
  }
  return undefined;
}
export function inventory(directory) {
  const rows = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) rows.push({ name: path.relative(directory, filename).replaceAll('\\', '/'), size: fs.statSync(filename).size });
    }
  }
  visit(directory);
  return rows;
}
export function relocateRuntimeLinks(source, destination) {
  const origin = path.resolve(source), staged = path.resolve(destination);
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isSymbolicLink()) {
        const link = fs.readlinkSync(filename);
        const originalFile = path.join(origin, path.relative(staged, filename));
        const resolved = path.resolve(path.dirname(originalFile), link);
        if (resolved !== origin && !resolved.startsWith(origin + path.sep)) throw new Error(`Runtime link escapes package: ${path.relative(staged, filename)}`);
        const portable = path.relative(path.dirname(filename), path.join(staged, path.relative(origin, resolved)));
        if (link !== portable) {
          const isDirectory = fs.statSync(filename).isDirectory();
          fs.unlinkSync(filename);
          fs.symlinkSync(portable, filename, isDirectory ? 'dir' : 'file');
        }
      }
    }
  }
  visit(staged);
}
export async function stageRuntime(source, destination, target) {
  if (!targets.includes(target)) throw new Error('Invalid package target');
  const resolvedSource = path.resolve(source), resolvedDestination = path.resolve(destination);
  if (resolvedSource === resolvedDestination || resolvedSource.startsWith(resolvedDestination + path.sep) || resolvedDestination.startsWith(resolvedSource + path.sep)) throw new Error('Staging must be separate from the original runtime');
  const marker = JSON.parse(fs.readFileSync(path.join(source, 'runtime-manifest.json')));
  if (`${marker.platform}-${marker.arch}` !== target) throw new Error('Runtime staging target mismatch');
  const before = inventory(source);
  const removed = before.filter(row => exclusionReason(row.name, target));
  // Only remove this dedicated generated staging directory, never the development runtime.
  await fs.promises.rm(destination, { recursive: true, force: true });
  await fs.promises.cp(source, destination, {
    recursive: true, verbatimSymlinks: true,
    filter: filename => !exclusionReason(path.relative(source, filename), target),
  });
  relocateRuntimeLinks(source, destination);
  const after = inventory(destination);
  if (after.some(row => exclusionReason(row.name, target))) throw new Error('Unexpected files in staged runtime');
  const removedBytesByReason = {};
  for (const row of removed) {
    const reason = exclusionReason(row.name, target);
    removedBytesByReason[reason] = (removedBytesByReason[reason] || 0) + row.size;
  }
  return { sourceBytes: before.reduce((n, row) => n + row.size, 0), stagedBytes: after.reduce((n, row) => n + row.size, 0), removedBytesByReason, removedFiles: removed.length };
}
export function asarFiles(filename) {
  const fd = fs.openSync(filename, 'r');
  try {
    const header = Buffer.alloc(16);
    if (fs.readSync(fd, header, 0, 16, 0) !== 16 || header.readUInt32LE(0) !== 4) throw new Error('Invalid ASAR header');
    const size = header.readUInt32LE(12);
    if (size > 32 * 1024 * 1024) throw new Error('Unexpected ASAR header size');
    const json = Buffer.alloc(size);
    if (fs.readSync(fd, json, 0, size, 16) !== size) throw new Error('Incomplete ASAR header');
    const rows = [];
    function visit(node, prefix = '') {
      for (const [name, entry] of Object.entries(node.files || {})) {
        const relative = prefix ? `${prefix}/${name}` : name;
        if (entry.files) visit(entry, relative);
        else if (typeof entry.size === 'number') rows.push({ name: relative, size: entry.size });
      }
    }
    visit(JSON.parse(json.toString()));
    return rows;
  } finally { fs.closeSync(fd); }
}
export function verifyPackageContents(resources, target) {
  const files = asarFiles(path.join(resources, 'app.asar'));
  const forbidden = files.filter(row => exclusionReason(row.name, target) || row.name.startsWith('node_modules/@amiba/app-runtime/resources/'));
  if (forbidden.length) throw new Error(`Forbidden packaged content: ${forbidden.slice(0, 5).map(row => row.name).join(', ')}`);
  const runtime = inventory(path.join(resources, 'resources/dsh-runtime'));
  if (runtime.some(row => exclusionReason(row.name, target))) throw new Error('Packaged runtime includes excluded content');
  const largest = rows => [...rows].sort((a,b) => b.size-a.size).slice(0, 15);
  return { asarBytes: fs.statSync(path.join(resources, 'app.asar')).size, runtimeBytes: runtime.reduce((n,row) => n + row.size, 0), largestAppFiles: largest(files), largestRuntimeFiles: largest(runtime) };
}
