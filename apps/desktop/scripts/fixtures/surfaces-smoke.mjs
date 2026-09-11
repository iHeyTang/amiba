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
      webPreferences: { contextIsolation: true, nodeIntegration: false },
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
    try {
      await win.loadURL(process.env.AMIBA_SURFACE_URL);
      await wait("!!window.surfaceHarness");
      await click("header button");
      await wait('!!document.querySelector("[data-probe=overlay]")');
      for (const slot of [
        "amiba.emptyState.visual",
        "amiba.composer.accessory",
        "amiba.message.decoration",
      ]) {
        await click(`[data-surface-selector="${slot}"]`);
        await wait(
          'Array.from(document.querySelectorAll("[role=option]")).some(e=>e.textContent.includes("Interaction probe"))',
        );
        await js(
          'Array.from(document.querySelectorAll("[role=option]")).find(e=>e.textContent.includes("Interaction probe")).click()',
        );
      }
      await wait(
        'document.querySelector("[data-probe=empty]")?.dataset.enabled==="true"',
      );
      await click('[data-surface-selector="amiba.emptyState.visual"]');
      await wait('Array.from(document.querySelectorAll("[role=option]")).some(e=>e.textContent.includes("Welcome card probe"))');
      await js('Array.from(document.querySelectorAll("[role=option]")).find(e=>e.textContent.includes("Welcome card probe")).click()');
      await wait('!!document.querySelector("[data-probe-card]") && !document.querySelector("[data-probe=empty]")');
      await js('window.surfaceHarness.select("amiba.emptyState.visual","surface-probe")');
      await wait('document.querySelector("[data-probe=empty]")?.dataset.enabled==="true"');
      await js('(()=>{const spacer=document.createElement("div");spacer.id="scroll-test";spacer.style.height="150vh";document.body.append(spacer);window.scrollTo(0,document.body.scrollHeight)})()');
      await wait('document.querySelector("[data-probe=overlay]")?.dataset.enabled==="true"');
      await js('document.getElementById("scroll-test").remove();window.scrollTo(0,0)');
      await wait('document.querySelector("[data-probe=empty]")?.dataset.enabled==="true"');
      await assert(
        'document.querySelector("[data-probe=composer]")?.dataset.enabled==="false" && document.querySelector("[data-probe=overlay]")?.dataset.enabled==="false"',
      );
      await wait(
        '!!document.querySelector("[data-message-decoration=message-a] [data-probe]")',
      );
      await assert(
        '!document.querySelector("[data-composer-card]").contains(document.querySelector("[data-composer-accessory]"))',
      );
      await click("header button:nth-child(3)");
      await wait('!!document.querySelector("[data-menu]")');
      await assert(
        'document.querySelector("[data-menu]").getBoundingClientRect().bottom <= document.querySelector("[data-composer-accessory]").getBoundingClientRect().top',
      );
      const r = await js(
        '(()=>{const r=document.querySelector("[data-testid=surface]").getBoundingClientRect();return {x:Math.round(r.right-10),y:Math.round(r.y+30)}})()',
      );
      win.webContents.sendInputEvent({ type: "mouseMove", ...r });
      await wait(
        'Number(document.querySelector("[data-probe=empty]").dataset.x)>.7',
      );
      await click("[contenteditable=true]");
      await wait("document.activeElement?.isContentEditable===true");
      await win.webContents.insertText("hello");
      await wait(
        'document.querySelector("[data-probe=empty]")?.dataset.typing==="true"',
      );
      await js(
        'document.querySelector("[contenteditable=true]").dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:"你"}))',
      );
      await wait(
        'document.querySelector("[data-probe=empty]")?.dataset.composing==="true"',
      );
      await js(
        'document.querySelector("[contenteditable=true]").dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"你好"}))',
      );
      await wait(
        'document.querySelector("[data-probe=empty]")?.dataset.composing==="false"',
      );
      await js(
        'window.surfaceHarness.event({kind:"begin",assistantUiId:"run"})',
      );
      await wait(
        'document.querySelector("[data-probe=empty]").dataset.phase==="thinking"',
      );
      await js('window.surfaceHarness.event({kind:"done"})');
      await wait(
        'document.querySelector("[data-probe=empty]").dataset.phase==="completed"',
      );
      await click("header button:nth-child(2)");
      await wait(
        'window.surfaceHarness.session==="b" && document.querySelector("[data-probe=empty]").dataset.phase==="idle"',
      );
      await js(
        'window.surfaceHarness.snapshot({type:"snapshot",sessionId:"b",kind:"completed",state:{pendingApprovals:[],pendingQuestions:[],error:null}})',
      );
      await wait(
        'document.querySelector("[data-probe=empty]").dataset.restored==="true"',
      );
      await js('document.querySelector("[data-probe=empty]").focus()');
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      await wait(
        'Number(document.querySelector("[data-probe=empty]").dataset.clicks)>0',
      );
      win.hide();
      await wait(
        'Array.from(document.querySelectorAll("[data-probe]")).every(e=>e.dataset.enabled==="false")',
      );
      win.show();
      await wait(
        'document.querySelector("[data-probe=empty]").dataset.enabled==="true"',
      );
      await writeFile(
        path.join(tmpdir(), "amiba-surfaces-desktop.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await click("header button");
      await wait(
        '!document.querySelector("[data-probe]") && !!document.querySelector("[data-default]")',
      );
      await click("header button");
      await wait(
        'document.querySelector("[data-probe=empty]")?.dataset.enabled==="true"',
      );
      await win.webContents.reload();
      await wait("!!window.surfaceHarness");
      await click("header button");
      await wait('!!document.querySelector("[data-probe=empty]")');
      win.setSize(390, 844);
      await new Promise((r) => setTimeout(r, 300));
      await assert("document.documentElement.scrollWidth <= window.innerWidth");
      await writeFile(
        path.join(tmpdir(), "amiba-surfaces-mobile.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      if (errors.length) throw new Error(errors.join("\n"));
      console.log(
        "Surface integration passed: real DSH renderer, plugin selection/persistence/unload, real Composer and MessageTurns, pointer/typing/IME, keyboard click, session recovery, global election, menu separation, visibility and mobile layout.",
      );
      app.exit(0);
    } catch (e) {
      console.error(e);
      console.error(
        await js(
          'JSON.stringify({active:document.activeElement?.outerHTML,probes:Array.from(document.querySelectorAll("[data-probe]")).map(e=>({...e.dataset}))})',
        ),
      );
      await writeFile(
        path.join(tmpdir(), "amiba-surfaces-failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
