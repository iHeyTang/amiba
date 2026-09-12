import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
async function sources(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sources(filename));
    else if (/\.[jt]sx?$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(filename);
  }
  return files;
}
for (const directory of ["apps/desktop/src", "packages/ui/src"]) {
  for (const filename of await sources(path.join(root, directory))) {
    const body = await readFile(filename, "utf8");
    assert(!/EmbeddedBrowser|embeddedBrowser|embedded-browser:|persist:amiba-browser|amiba_browser_/.test(body), `Browser implementation leaked into host: ${path.relative(root, filename)}`);
  }
}
const plugin = path.join(root, "plugins/dsh-plugin-browser-provider-electron");
const manifest = JSON.parse(await readFile(path.join(plugin, "package.json"), "utf8"));
assert(manifest.dsh.native && manifest.dsh.client && manifest.dsh.bundle?.patch, "Browser must ship native, client and activation entries");
for (const entry of [manifest.dsh.native, manifest.dsh.bundle.patch, "lib/client.js"]) await readFile(path.join(plugin, entry));
const desktop = await readFile(path.join(root, "bundles/dsh-bundle-amiba-desktop/cordis.patch.yml"), "utf8");
assert(!desktop.includes("amiba-browser"), "Desktop base must not activate the optional browser");
const platform = await readFile(path.join(root, "packages/app-runtime/src/platform/index.ts"), "utf8");
assert(!/EmbeddedBrowser|embeddedBrowser/.test(platform), "Platform must expose only generic native transport");
console.log("[browser-pluginization] host boundary and independently installable package verified");
