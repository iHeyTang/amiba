import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Ship the shared, Electron-independent runtime helpers with the public CLI.
// The private workspace package and the desktop's multi-GB runtime are not npm dependencies.
const cli = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.resolve(cli, '../../packages/app-runtime');
const dist = path.join(cli, 'dist');
const vendor = path.join(dist, 'vendor/app-runtime');
await fs.rm(vendor, { recursive: true, force: true });
await fs.mkdir(path.join(vendor, 'dist'), { recursive: true });
await fs.cp(path.join(runtime, 'dist/dsh-runtime'), path.join(vendor, 'dist/dsh-runtime'), { recursive: true });
await fs.copyFile(path.join(runtime, 'dsh-runtime-manifest.json'), path.join(vendor, 'dsh-runtime-manifest.json'));
await fs.copyFile(path.join(runtime, 'src/dsh-distribution/index.js'), path.join(vendor, 'distribution.js'));
await fs.writeFile(path.join(vendor, 'package.json'), JSON.stringify({
  name: '@amiba/app-runtime', private: true, type: 'module', exports: { './dsh-distribution': './distribution.js' },
}, null, 2));
for (const relative of await fs.readdir(dist, { recursive: true })) {
  if (!relative.endsWith('.js') || relative.startsWith(`vendor${path.sep}`)) continue;
  const file = path.join(dist, relative);
  const source = await fs.readFile(file, 'utf8');
  const replacement = './' + path.relative(path.dirname(file), path.join(vendor, 'dist/dsh-runtime/index.js')).split(path.sep).join('/');
  await fs.writeFile(file, source.replaceAll('"@amiba/app-runtime/dsh-runtime"', JSON.stringify(replacement)));
}
console.log('CLI package includes shared runtime helpers; no private workspace dependency.');
