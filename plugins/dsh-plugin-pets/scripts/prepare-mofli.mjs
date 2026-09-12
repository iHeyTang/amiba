import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

// This adapter is private to the pet plugin. DSH loads the plugin's built output.
export async function prepareMofli(
  directory = fileURLToPath(new URL("../", import.meta.url)),
) {
  const modules = path.join(directory, "node_modules/@mofli");
  const core = JSON.parse(
    await fs.readFile(path.join(modules, "core/package.json"), "utf8"),
  );
  const grove = JSON.parse(
    await fs.readFile(path.join(modules, "grove/package.json"), "utf8"),
  );
  const spatial =
    !!core.exports?.["./spatial-browser"] &&
    !!grove.exports?.["./rigs/spatial"];
  const index = await import(
    pathToFileURL(path.join(modules, "grove/dist/index.js")).href
  );
  const actions = Array.isArray(index.companionActions);
  const contents = `// Generated from installed Mofli exports. Run pnpm prepare:mofli; do not edit.\nimport type { PetRegistry } from '@mofli/core';\n${
    spatial
      ? `import { grovePack as flatPack } from '@mofli/grove';
import { spatialRig, spatialSkins, spatialParts } from '@mofli/grove/rigs/spatial';
import { createSpatialRenderer } from '@mofli/core/spatial-browser';
export { createSpatialRenderer };
export const grovePack = { ...flatPack, rigs: [...flatPack.rigs, spatialRig], skins: [...flatPack.skins, ...spatialSkins], attachments: [...flatPack.attachments, ...spatialParts] };
export function renderSpatial(renderer: ReturnType<typeof createSpatialRenderer>, pet: ReturnType<PetRegistry['create']>, time: number, reduced: boolean) { renderer.render(pet.sampleScene(time, reduced)); }
`
      : `export { grovePack } from '@mofli/grove';
export function createSpatialRenderer(_host: HTMLElement): { element: HTMLCanvasElement; destroy(): void } { throw new Error('This Mofli version does not support 3D pets.'); }
export function renderSpatial(_renderer: ReturnType<typeof createSpatialRenderer>, _pet: ReturnType<PetRegistry['create']>, _time: number, _reduced: boolean): void { throw new Error('This Mofli version does not support 3D pets.'); }
`
  }
export const hasSpatial = ${spatial};
export const hasCompanionActions = ${actions};
${actions ? `export { companionActions } from '@mofli/grove';` : `export const companionActions: readonly { scene: string; duration: number; expression: number; id: string }[] = [];`}
export function dimensionOf(value: unknown): '2d' | '3d' { return value && typeof value === 'object' && 'dimension' in value && value.dimension === '3d' ? '3d' : '2d'; }
`;
  const target = path.join(directory, "src/mofli-capabilities.generated.ts");
  if ((await fs.readFile(target, "utf8").catch(() => "")) !== contents)
    await fs.writeFile(target, contents);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await prepareMofli();
