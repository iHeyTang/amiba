import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { imageDocumentFixtures } from './image-document-fixtures.mjs';

/** Decode real encoded files through the native file service and image document body. */
export async function smokeImageDocuments({ evaluate, wait, fileWorkspace, captureImage }) {
  const directory = path.join(fileWorkspace, '.cache');
  await mkdir(directory, { recursive: true });
  const revoked = async (url, message) => assert.ok(await evaluate(`new Promise(resolve=>{
    const image=new Image();image.onload=()=>resolve(false);image.onerror=()=>resolve(true);image.src=${JSON.stringify(url)};
  })`), message);
  for (const fixture of imageDocumentFixtures) {
    // Upper-case suffixes exercise registration and media-type normalization too.
    const relative = `.cache/compat-image-${fixture.name}.${fixture.extension.toUpperCase()}`;
    const file = path.join(fileWorkspace, relative);
    const bytes = Buffer.from(fixture.base64, 'base64');
    const ready = () => evaluate(`(()=>{
      const image=document.querySelector('[data-image-preview] img');
      return !!image && !image.hidden && image.complete && image.naturalWidth===${fixture.width} && image.naturalHeight===${fixture.height};
    })()`);
    try {
      await writeFile(file, bytes);
      await evaluate(`window.__sidebarService.openResource('dsh-resource://file/session/'+encodeURIComponent(window.__compatSessionId)+'/'+${JSON.stringify(relative)})`);
      await wait(ready);
      const output = await evaluate(`(()=>{
        const image=document.querySelector('[data-image-preview] img');
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);
        const rect=image.getBoundingClientRect();
        return {width:rect.width,height:rect.height,url:image.src,left:[...context.getImageData(8,16,1,1).data],right:[...context.getImageData(24,16,1,1).data]};
      })()`);
      assert.equal(output.width, fixture.width, `${fixture.name}: intrinsic width`);
      assert.equal(output.height, fixture.height, `${fixture.name}: intrinsic height`);
      assert.ok(output.url.startsWith('blob:'), `${fixture.name}: actual bytes URL`);
      for (const [pixel, expected] of [[output.left, [224,32,32,255]], [output.right, [32,64,224,255]]]) {
        assert.ok(pixel.every((channel,index)=>Math.abs(channel-expected[index])<=25), `${fixture.name}: decoded swatch ${pixel}`);
      }
      if (fixture.animated) {
        assert.equal(typeof captureImage, 'function', 'Animation requires actual compositor screenshots');
        const clip = await evaluate("(()=>{const r=document.querySelector('[data-image-preview] img').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");
        const colors = new Set();
        await wait(async () => {
          const screenshot = await captureImage(clip);
          const pixel = await evaluate(`new Promise((resolve,reject)=>{
            const image=new Image();image.onerror=()=>reject(new Error('Screenshot decode failed'));
            image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
              const context=canvas.getContext('2d');context.drawImage(image,0,0);resolve([...context.getImageData(Math.floor(canvas.width/4),Math.floor(canvas.height/2),1,1).data]);};
            image.src='data:image/png;base64,'+${JSON.stringify(screenshot)};
          })`);
          if (pixel[0]>180 && pixel[2]<90) colors.add('red');
          if (pixel[2]>180 && pixel[0]<90) colors.add('blue');
          return colors.size===2;
        });
        console.log(`Image ${fixture.extension} animation displayed both real compositor frames.`);
      }
      await writeFile(file, 'invalid image');
      await wait(() => evaluate("!!document.querySelector('[data-textpreview-changed]')"));
      await evaluate("document.querySelector('[data-textpreview-reload-now]').click()");
      await wait(() => evaluate("!!document.querySelector('[data-image-preview] [role=alert]')"));
      await revoked(output.url, `${fixture.name}: replaced URL revoked`);
      await writeFile(file, bytes);
      await wait(() => evaluate("!!document.querySelector('[data-textpreview-changed]')"));
      await evaluate("document.querySelector('[data-textpreview-reload-now]').click()");
      await wait(ready);
      const recoveredUrl = await evaluate("document.querySelector('[data-image-preview] img').src");
      assert.notEqual(recoveredUrl, output.url, `${fixture.name}: fresh URL after recovery`);
      await evaluate("window.__sidebarService.close(window.__sidebarService.active().id)");
      await wait(() => evaluate("!document.querySelector('[data-image-preview]')"));
      await revoked(recoveredUrl, `${fixture.name}: closed URL revoked`);
      console.log(`Image ${fixture.name}.${fixture.extension} passed actual decoding, swatch pixels, intrinsic dimensions, corrupt reload/recovery and URL cleanup.`);
    } finally { await rm(file, { force: true }); }
  }
}
