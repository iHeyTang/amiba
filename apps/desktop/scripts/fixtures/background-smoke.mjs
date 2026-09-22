import { app, BrowserWindow } from "electron";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
app.setPath("userData", process.env.AMIBA_SURFACE_PROFILE);
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 1440,
      height: 940,
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: true,
      },
    });
    const errors = [];
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) errors.push(message);
    });
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = async (code) => {
      const end = Date.now() + 30000;
      while (Date.now() < end) {
        if (await js(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Timed out: " + code);
    };
    const assert = async (code) => {
      if (!(await js(code))) throw new Error("Assertion failed: " + code);
    };
    const output =
      process.env.AMIBA_BACKGROUND_EVIDENCE || "/tmp/amiba-background-evidence";
    try {
      console.log("background smoke: loading fixture");
      await mkdir(output, { recursive: true });
      await win.loadURL(process.env.AMIBA_SURFACE_URL);
      await wait("!!window.backgroundHarness?.controller.getSnapshot().ready");
      console.log("background smoke: generating video fixture");
      await js("window.backgroundHarness.animatedFixture()");
      await wait(
        '!!document.querySelector("[data-background-active]") && document.querySelector("video").currentTime > .1',
      );
      await assert(
        'document.querySelector("video").muted && document.querySelector("video").loop',
      );
      await assert(
        'getComputedStyle(document.querySelector("[data-background-surface=navigation]")).backdropFilter.includes("24px")',
      );
      await assert(
        'getComputedStyle(document.querySelector("[data-background-surface=reading]")).backdropFilter.includes("10px")',
      );
      await assert(
        'getComputedStyle(document.querySelector("[data-composer-card]")).backdropFilter.includes("28px")',
      );
      win.hide();
      await wait('document.hidden && document.querySelector("video").paused');
      win.show();
      await wait('!document.hidden && !document.querySelector("video").paused');
      win.webContents.debugger.attach("1.3");
      await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await wait('document.querySelector("video").paused');
      await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
        features: [],
      });
      await wait('!document.querySelector("video").paused');
      win.webContents.debugger.detach();
      await writeFile(
        path.join(output, "light.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await js('document.documentElement.classList.add("dark")');
      await new Promise((resolve) => setTimeout(resolve, 150));
      await writeFile(
        path.join(output, "dark.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await js("window.backgroundHarness.settings(true)");
      await wait('!!document.querySelector("[role=dialog]")');
      await writeFile(
        path.join(output, "settings.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await js("window.backgroundHarness.settings(false)");
      await js(
        '(()=>{const c=window.backgroundHarness.controller,s=c.getSnapshot().snapshot;return window.backgroundHarness.call("configure",{...s.config,motion:"pause"},s.revision)})()',
      );
      await wait('document.querySelector("video").paused');
      await win.loadURL(process.env.AMIBA_SURFACE_URL);
      await wait('!!document.querySelector("[data-background-active]")');
      await assert('document.querySelector("video").paused');
      await js(
        "(()=>{const c=window.backgroundHarness.controller,s=c.getSnapshot().snapshot;return c.configure({...s.config,enabled:false},s.revision)})()",
      );
      await wait('!document.querySelector("video")');
      await assert(
        'getComputedStyle(document.querySelector("[data-background-surface=layout]")).backgroundColor !== "rgba(0, 0, 0, 0)"',
      );
      if (errors.length) throw new Error(errors.join("\n"));
      console.log(
        JSON.stringify({
          ok: true,
          checks: [
            "video playback",
            "layered materials",
            "light/dark",
            "settings",
            "Agent change sync",
            "hidden-window pause",
            "reduced motion",
            "pause",
            "restart restoration",
            "disable restoration",
          ],
          output,
        }),
      );
      app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(errors);
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
