import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const desktop = path.join(root, 'apps/desktop');
const require = createRequire(path.join(desktop, 'package.json'));
const { build, Platform, Arch } = require('electron-builder');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (process.platform !== 'darwin') throw new Error('Mac packaging requires macOS');

await build({
  projectDir: desktop,
  // A config object is merged with package.json, concatenating resource arrays.
  // Load the complete generated config as a file, like the Windows CLI does.
  config: path.resolve(process.argv[2]),
  targets: Platform.MAC.createTarget(config.mac.target, Arch[process.arch]),
  publish: 'never',
  ...(process.argv[3] ? { prepackaged: path.resolve(process.argv[3]) } : {}),
  effectiveOptionComputed: async ({ volumePath, specification }) => {
    if (!config.dmg?.background || !volumePath || !specification.background) return false;
    // dmg-builder 25's legacy aliases can leave a blank background on modern
    // macOS. Let Finder persist its native background reference before compression.
    const directory = path.join(volumePath, '.background');
    const files = fs.readdirSync(directory).filter(name => /\.(png|tiff?)$/i.test(name));
    if (files.length !== 1) throw new Error('Expected one DMG background image');
    const [appIcon, applicationsIcon] = specification.contents;
    const { width, height } = specification.window;
    execFileSync('osascript', ['-', volumePath, path.join(directory, files[0]), `${config.productName || 'Amiba'}.app`], {
      input: `on run argv
  tell application "Finder"
    set installationFolder to POSIX file (item 1 of argv) as alias
    open installationFolder
    set installationWindow to container window of installationFolder
    set current view of installationWindow to icon view
    set toolbar visible of installationWindow to false
    set statusbar visible of installationWindow to false
    set bounds of installationWindow to {100, 100, ${100 + width}, ${100 + height}}
    set arrangement of icon view options of installationWindow to not arranged
    set icon size of icon view options of installationWindow to ${specification.iconSize}
    set text size of icon view options of installationWindow to ${specification.iconTextSize}
    set position of item (item 3 of argv) of installationWindow to {${appIcon.x}, ${appIcon.y}}
    set position of item "Applications" of installationWindow to {${applicationsIcon.x}, ${applicationsIcon.y}}
    set background picture of icon view options of installationWindow to POSIX file (item 2 of argv)
    close installationWindow
  end tell
  delay 2
end run`,
      encoding: 'utf8',
      timeout: 60000,
    });
    return false;
  },
});
