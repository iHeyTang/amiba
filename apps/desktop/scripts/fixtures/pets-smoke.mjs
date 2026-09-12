import { app, BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
app.setPath("userData", process.env.AMIBA_SURFACE_PROFILE);
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 1100,
      height: 900,
      show: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    const errors = [];
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) errors.push(message);
    });
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const wait = async (code) => {
      for (let i = 0; i < 200; i++) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("Timed out: " + code + "\n" + errors.join("\n"));
    };
    const assert = async (code) => {
      if (!(await js(code))) throw new Error("Assertion failed: " + code);
    };
    const click = async (selector) => {
      await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
      const r = await js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      );
      win.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...r,
      });
      win.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        ...r,
      });
    };

    const button = async (text) => {
      await wait(
        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)})`,
      );
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    };
    try {
      await win.loadURL(process.env.AMIBA_SURFACE_URL);
      await wait('!!document.querySelector("[data-mofli-pet] svg path")');
      await button("Save pet");
      await wait(
        'document.querySelector("aside").textContent.includes("Active")',
      );
      await button("Create with Agent");
      await wait('window.agentPrompt?.includes("pets_save")');
      await button("New pet");
      await js('document.querySelectorAll("[data-pet-skin]")[4].click()');
      await button("Save pet");
      await wait('document.querySelectorAll("[data-pet-record]").length===2');
      await button("Use as companion");
      await wait(
        'document.querySelectorAll("[data-pet-record]")[1].textContent.includes("Active")',
      );
      await writeFile(
        path.join(tmpdir(), "amiba-pets-manager.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await button("Open Studio");
      await wait('!!document.querySelector("iframe")');
      for (let i = 0; i < 160; i++) {
        if (
          win.webContents.mainFrame.frames.length &&
          (await win.webContents.mainFrame.frames[0].executeJavaScript(
            'document.querySelectorAll("button").length>5',
          ))
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const frame = win.webContents.mainFrame.frames[0];
      if (
        !frame ||
        !(await frame.executeJavaScript(
          'document.querySelectorAll("button").length>5',
        ))
      )
        throw new Error("Studio did not render");
      await writeFile(
        path.join(tmpdir(), "amiba-pets-studio.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await button("Back to pets");
      await click("[data-switch]");
      await wait('!!document.querySelector("[data-surface-selector]")');
      await js('window.petsHarness.select("amiba.emptyState.visual","mofli")');
      await wait(
        '!!document.querySelector(".surface [data-mofli-pet] svg path")',
      );
      await wait(
        'document.querySelector(".surface [data-mofli-pet] svg")?.dataset.playing==="true"',
      );
      await js(
        'window.beforePet=document.querySelector(".surface [data-mofli-pet] svg").innerHTML',
      );
      const r = await js(
        '(()=>{const r=document.querySelector(".surface").getBoundingClientRect();return{x:Math.round(r.right-5),y:Math.round(r.top+20)}})()',
      );
      win.webContents.sendInputEvent({ type: "mouseMove", ...r });
      await wait(
        'document.querySelector(".surface [data-mofli-pet] svg").innerHTML!==window.beforePet',
      );
      await writeFile(
        path.join(tmpdir(), "amiba-pets-companion.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await js('window.petsHarness.select("amiba.composer.accessory","mofli")');
      await wait('!!document.querySelector("[data-composer-card] [data-composer-accessory] [data-mofli-pet] svg")');
      await wait('document.querySelector("[data-composer-accessory] svg").style.opacity === "0"');
      await assert('document.querySelectorAll(".surface [data-mofli-pet] svg[data-playing=true]").length === 1');
      await click("[data-conversation]");
      await wait('document.querySelector("[data-composer-accessory] svg").style.opacity === "1"');
      await assert('document.querySelectorAll(".surface [data-mofli-pet]").length === 1');
      await assert(`(()=>{const pet=document.querySelector("[data-composer-accessory]").getBoundingClientRect();const card=document.querySelector("[data-composer-card]").getBoundingClientRect();return pet.top<card.top && pet.bottom>card.top && pet.bottom<=card.top+9 && pet.right<=card.right})()`);
      await js(`(()=>{const r=document.querySelector('[data-composer-perch]').getBoundingClientRect();const e=document.createElement('div');e.id='test-popup';e.setAttribute('role','listbox');e.style.cssText='position:fixed;z-index:100;background:#eee;left:'+r.left+'px;top:'+r.top+'px;width:180px;height:120px';document.body.append(e)})()`);
      await wait(`(()=>{const p=document.querySelector('[data-composer-perch]').getBoundingClientRect(),r=document.querySelector('#test-popup').getBoundingClientRect();return p.left>=r.right || p.right<=r.left || p.bottom<=r.top || p.top>=r.bottom})()`);
      await js("document.querySelector('#test-popup').remove()");
      await wait("document.querySelector('[data-composer-perch]').style.transform==='translate(0px, 0px)'");
      await new Promise(r => setTimeout(r, 250));
      await assert(`(()=>{const p=document.querySelector('[data-composer-perch]').getBoundingClientRect(),c=document.querySelector('[data-composer-card]').getBoundingClientRect();return Math.abs(c.right-p.right-16)<2})()`);
      await assert('document.querySelector("[data-composer-accessory] svg").dataset.companionScene === "idle"');
      await assert(`(()=>{const p=document.querySelector('[data-composer-perch]').getBoundingClientRect(),d=document.querySelector('[data-composer-dock]').getBoundingClientRect();return p.top>=d.top+8 && document.querySelector('[data-composer-dock]').style.getPropertyValue('--amiba-companion-clearance')==='84px'})()`);
      await writeFile(path.join(tmpdir(), "amiba-pets-composer-docked.png"), (await win.webContents.capturePage()).toPNG());
      await assert('!window.petsHarness.getSurfaces().rows["amiba.message.decoration"].some(row=>row.id==="mofli")');
      win.setSize(560, 900);
      await new Promise(r=>setTimeout(r, 150));
      await assert(`(()=>{const pet=document.querySelector("[data-composer-accessory]").getBoundingClientRect();const card=document.querySelector("[data-composer-card]").getBoundingClientRect();return pet.left>=card.left && pet.right<=card.right && pet.bottom<=card.bottom})()`);
      win.setSize(1100, 900);
      await click("[data-conversation]");
      await wait('document.querySelector("[data-composer-accessory] svg").style.opacity === "0"');
      await js("window.petsHarness.remote.activate(null)");
      await wait('!document.querySelector(".surface [data-mofli-pet]")');
      await click("[data-switch]");
      await wait('document.querySelectorAll("[data-pet-record]").length===2');
      await js('document.querySelectorAll("[data-pet-record]")[1].click()');
      await click('[aria-label="Delete"]');
      await wait('document.querySelectorAll("[data-pet-record]").length===1');
      if (errors.length) throw new Error(errors.join("\n"));
      console.log(
        "Mofli integration passed: real npm engine/Grove, DSH slot registration, durable multi-pet creation/activation/deletion, Agent entry, isolated Studio rendering and regional companion.",
      );
      app.exit(0);
    } catch (e) {
      console.error(e);
      console.error(errors.join("\n"));console.error(await js('JSON.stringify({visible:document.visibilityState,body:document.body.innerText.slice(0,300),pet:document.querySelector(".surface [data-mofli-pet] svg")?.outerHTML.slice(0,300)})'));
      for (const f of win.webContents.mainFrame.frames) {
        console.error(await f.executeJavaScript("document.body.innerText"));
      }
      await writeFile(
        path.join(tmpdir(), "amiba-pets-failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
