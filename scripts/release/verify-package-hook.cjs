// Fail before signing or spending time compressing installers if excluded files leaked in.
module.exports = async context => {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const { verifyPackageContents } = await import(pathToFileURL(path.join(__dirname, 'package-content.mjs')).href);
  const fs = require('node:fs');
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources')
    : path.join(context.appOutDir, 'resources');
  const marker = JSON.parse(fs.readFileSync(path.join(resources, 'resources/dsh-runtime/runtime-manifest.json')));
  verifyPackageContents(resources, `${marker.platform}-${marker.arch}`);
  if (context.electronPlatformName === 'darwin' && context.packager.platformSpecificBuildOptions.identity === null) {
    // No Apple account or certificate is involved. Seal the final bundle locally
    // instead of leaving Electron's linker signature bound to its original app.
    const { spawnSync } = require('node:child_process');
    const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    for (const args of [['--force', '--deep', '--sign', '-', '--timestamp=none', app], ['--verify', '--deep', '--strict', app]]) {
      const result = spawnSync('codesign', args, { encoding: 'utf8', timeout: 300000 });
      if (result.error || result.status !== 0) throw new Error(`Ad-hoc bundle sealing failed: ${result.error?.message || result.stderr}`);
    }
  }
};
