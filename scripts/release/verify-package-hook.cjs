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
};
