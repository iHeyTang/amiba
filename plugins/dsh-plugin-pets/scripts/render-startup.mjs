// Pre-render the real rig so the earliest boot frame needs no plugin runtime.
import { JSDOM } from 'jsdom';
import { PetRegistry } from '@mofli/core';
import { createSvgRenderer } from '@mofli/core/browser';
import { grovePack } from '@mofli/grove';
import { writeFile, readFile } from 'node:fs/promises';
globalThis.document = new JSDOM('<div></div>').window.document;
const pet = new PetRegistry().registerPacks(grovePack).create({version:1, skin:grovePack.skins[0], rigConfig:{customFace:1,faceYaw:0,facePitch:0,faceRoll:0}, pose:{state:0,expression:-1}, attachments:[]});
const renderer = createSvgRenderer(document.querySelector('div'));
const frames = [];
for(let i=0;i<96;i++) {
  const time=i/12;
  pet.engine.handle({type:'look',value:{x:0,y:0}},time);
  renderer.render(pet.sample(time));
  frames.push(renderer.svg.cloneNode(true));
}
const svg=frames[0];
svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
const license=await readFile(new URL('../node_modules/@mofli/grove/LICENSE',import.meta.url),'utf8');
const prefix='<!-- Rendered from @mofli/grove 0.1.1 Mallow.\n'+license+'-->\n';
const normalize = text => text.replace(/mofli-[a-f0-9-]{36}/g,'startup-pet');
const base=new URL('../../../apps/desktop/src/renderer/assets/',import.meta.url);
await writeFile(new URL('startup-pet-still.svg',base),prefix+normalize(svg.outerHTML));
const elements=[...svg.querySelectorAll('*')];
const snapshots=frames.map(f=>[...f.querySelectorAll('*')]);
elements.forEach((el,index)=>{
  for(const attr of [...el.attributes]) {
    if(!['d','cx','cy','rx','ry','transform','opacity'].includes(attr.name)) continue;
    const values=snapshots.map(nodes=>nodes[index]?.getAttribute(attr.name) ?? attr.value);
    if(values.every(v=>v===values[0])) continue;
    const a=document.createElementNS('http://www.w3.org/2000/svg','animate');
    for(const [key,value] of Object.entries({attributeName:attr.name,values:values.join(';'),dur:'8s',repeatCount:'indefinite',calcMode:'discrete'}))a.setAttribute(key,value);
    el.append(a);
  }
});
await writeFile(new URL('startup-pet.svg',base),prefix+normalize(svg.outerHTML));
