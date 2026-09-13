// Generate the app icon from the same Mallow rig used by the default pet.
import { JSDOM } from 'jsdom';
import { PetRegistry } from '@mofli/core';
import { createSvgRenderer } from '@mofli/core/browser';
import { grovePack } from '@mofli/grove';
import { writeFile, readFile } from 'node:fs/promises';
globalThis.document = new JSDOM('<div></div>').window.document;
const pet = new PetRegistry().registerPacks(grovePack).create({
  version: 1, skin: grovePack.skins[0],
  rigConfig: { customFace: 1, faceYaw: 0, facePitch: 0, faceRoll: 0 },
  pose: { state: 0, expression: -1 }, attachments: [],
});
const renderer = createSvgRenderer(document.querySelector('div'));
pet.engine.handle({ type: 'look', value: { x: 0, y: 0 } }, 0);
renderer.render(pet.sample(0));
const svg = renderer.svg;
svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
svg.setAttribute('width', '1024');
svg.setAttribute('height', '1024');
// Keep the existing warm paper tile and tilt the whole head, not just its eyes.
const head = document.createElementNS('http://www.w3.org/2000/svg', 'g');
head.setAttribute('transform', 'rotate(7)');
while (svg.firstChild) head.append(svg.firstChild);
const tile = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
for (const [key, value] of Object.entries({ x: -127.14, y: -127.14, width: 254.28, height: 254.28, rx: 55, fill: '#f4f2ed' })) tile.setAttribute(key, String(value));
svg.append(tile, head);
const license = await readFile(new URL('../node_modules/@mofli/grove/LICENSE', import.meta.url), 'utf8');
const prefix = '<!-- Rendered from @mofli/grove 0.1.1 Mallow.\n' + license + '-->\n';
await writeFile(new URL('../../../apps/desktop/resources/icon.svg', import.meta.url), prefix + svg.outerHTML.replace(/mofli-[a-f0-9-]{36}/g, 'amiba-icon'));
