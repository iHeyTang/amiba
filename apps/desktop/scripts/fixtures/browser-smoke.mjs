import { app, BrowserWindow, webContents, ipcMain } from "electron";
import { createRequire } from "node:module";
import http from "node:http";
import { mkdir, writeFile, cp, readFile } from "node:fs/promises";
import path from "node:path";
const root = process.env.AMIBA_BROWSER_SMOKE_ROOT;
const output = process.env.AMIBA_BROWSER_SMOKE_OUTPUT;
const require = createRequire(import.meta.url);
const { DesktopExtensionHost } = require(path.join(root, "host.cjs"));
app.setPath("userData", path.join(root, "user-data"));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
let win, host, server, runtime, gateway;
let profileManifest = path.join(root, "package.json");
const timeout = setTimeout(() => {
  console.error("Browser smoke timed out");
  app.exit(1);
}, 100_000);
app.whenReady().then(async () => {
  try {
    server = http.createServer((_req, response) =>
      response.end(
        '<html><title>Browser plugin smoke</title><body style="background:white;color:black"><h1>Installed browser</h1><input aria-label="Name"><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Run</button></body></html>',
      ),
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({
      show: true,
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webviewTag: true,
      },
    });
    win.webContents.on("console-message", (_event, level, message) =>
      console.log("renderer", level, message),
    );
    win.webContents.on("render-process-gone", (_event, details) =>
      console.error(details),
    );
    host = new DesktopExtensionHost({
      profileManifest: () => profileManifest,
      context: {
        hostContentsId: () => win.webContents.id,
        emit: (owner, event, payload) =>
          webContents.fromId(owner)?.send(event, payload),
      },
    });
    win.webContents.on("will-attach-webview", (event, preferences, params) => {
      if (!host.allowsPartition(params.partition)) {
        event.preventDefault();
        return;
      }
      preferences.nodeIntegration = false;
      preferences.contextIsolation = true;
      preferences.sandbox = true;
      delete preferences.preload;
    });
    ipcMain.handle("native-extension:call", (event, lease, method, args) =>
      host.rendererCall(event.sender.id, lease, method, args),
    );
    await win.loadURL("data:text/html,<body><h1>Workbench fixture</h1></body>");
    await win.webContents.executeJavaScript(`(() => {
    const { ipcRenderer } = require('electron'); window.created = [];
    ipcRenderer.on('native-extension:event', (_event, message) => {
      if (message.event !== 'embedded-browser:create-tab') return;
      const guest = document.createElement('webview');
      const tabId = 'tab-' + Math.random().toString(36).slice(2);
      guest.setAttribute('partition', 'persist:amiba-browser'); guest.setAttribute('src', 'about:blank');
      guest.style.cssText = 'width:760px;height:500px';
      guest.addEventListener('dom-ready', () => ipcRenderer.invoke('native-extension:call', message.lease, 'register-tab', { tabId, webContentsId: guest.getWebContentsId(), active: true, sessionId: message.payload.sessionId }).catch(error => console.error(error)));
      document.body.append(guest); window.created.push(tabId);
    });
  })()`);
    const packageName = "@amiba/dsh-plugin-browser-provider-electron";
    let lease = host.attach(packageName, "installed");
    // Import is a user-facing renderer capability, never an agent tool.
    await host.call(lease, "cookie-import:run-all", {}, {}).then(
      () => {
        throw new Error("Agent accessed one-click import");
      },
      (error) =>
        assert(
          error.message.includes("Unknown browser operation"),
          "Wrong one-click access error",
        ),
    );
    await host
      .rendererCall(win.webContents.id, lease, "cookie-import:run-all", {
        sourceId: "not-a-profile",
      })
      .then(
        () => {
          throw new Error("One-click import accepted an unknown source");
        },
        (error) =>
          assert(
            error.message.includes("INVALID_SOURCE"),
            "Packed one-click route is missing",
          ),
      );
    await host.call(lease, "cookie-import:run", {}, {}).then(
      () => {
        throw new Error("Agent accessed the cookie importer");
      },
      (error) =>
        assert(
          error.message.includes("Unknown browser operation"),
          "Wrong import access error",
        ),
    );
    await host
      .rendererCall(win.webContents.id, lease, "cookie-import:sites", {
        sourceId: "not-a-profile",
      })
      .then(
        () => {
          throw new Error("Unknown profile was accepted");
        },
        (error) =>
          assert(
            error.message.includes("INVALID_SOURCE"),
            "Packed importer route is missing",
          ),
      );
    const opened = await host.call(
      lease,
      "amiba_browser_open",
      { url },
      { sessionId: "a" },
    );
    assert(
      opened.structuredContent.url.startsWith(url),
      "Open did not navigate",
    );
    const firstGuest = webContents
      .getAllWebContents()
      .find((contents) => contents.getType() === "webview");
    assert(firstGuest, "No real Electron guest");
    const snap = await host.call(
      lease,
      "amiba_browser_snapshot",
      {},
      { sessionId: "a" },
    );
    assert(
      snap.structuredContent.snapshot.includes("Installed browser"),
      "Snapshot missing page text",
    );
    await host.call(
      lease,
      "amiba_browser_type",
      { target: "input", text: "Ada" },
      { sessionId: "a" },
    );
    assert(
      (await firstGuest.executeJavaScript(
        "document.querySelector('input').value",
      )) === "Ada",
      "Input failed",
    );
    await host.call(
      lease,
      "amiba_browser_click",
      { target: "button" },
      { sessionId: "a" },
    );
    assert(
      (await firstGuest.executeJavaScript(
        "document.querySelector('h1').textContent",
      )) === "Clicked",
      "Click failed",
    );
    const screenshot = await host.call(
      lease,
      "amiba_browser_screenshot",
      {},
      { sessionId: "a" },
    );
    const image = screenshot.content.find((block) => block.type === "image");
    assert(image?.data, "Screenshot missing");
    await writeFile(
      path.join(output, "browser.png"),
      Buffer.from(image.data, "base64"),
    );
    host.detach(lease);
    assert(firstGuest.isDestroyed(), "Uninstall left a live guest");
    assert(
      !host.allowsPartition("persist:amiba-browser"),
      "Uninstall left partition enabled",
    );
    await host.call(lease, "amiba_browser_snapshot", {}, {}).then(
      () => {
        throw new Error("Stale lease was accepted");
      },
      (error) =>
        assert(error.message.includes("unloaded"), "Wrong stale lease error"),
    );
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('webview').forEach(element => element.remove())",
    );
    const replacement = path.join(root, "node_modules/replacement-browser");
    await cp(path.join(root, "node_modules", packageName), replacement, {
      recursive: true,
    });
    const replacementManifest = JSON.parse(
      await readFile(path.join(replacement, "package.json"), "utf8"),
    );
    replacementManifest.name = "replacement-browser";
    await writeFile(
      path.join(replacement, "package.json"),
      JSON.stringify(replacementManifest),
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { "replacement-browser": "1.0.0" } }),
    );
    lease = host.attach("replacement-browser", "replacement");
    await host.call(lease, "amiba_browser_open", { url }, { sessionId: "b" });
    const replacementSnap = await host.call(
      lease,
      "amiba_browser_snapshot",
      {},
      { sessionId: "b" },
    );
    assert(
      replacementSnap.structuredContent.snapshot.includes("Installed browser"),
      "Replacement failed",
    );
    // A task waiting for a not-yet-mounted background tab must fail immediately on unload.
    await win.webContents.executeJavaScript(
      "require('electron').ipcRenderer.removeAllListeners('native-extension:event')",
    );
    const pending = host.call(
      lease,
      "amiba_browser_open",
      { url },
      { sessionId: "never-mounted" },
    );
    host.reset();
    await pending.then(
      () => {
        throw new Error("Unloaded pending request completed");
      },
      (error) =>
        assert(
          error.message.includes("unloaded"),
          "Pending call did not reject on unload",
        ),
    );
    assert(
      webContents
        .getAllWebContents()
        .filter((contents) => contents.getType() === "webview").length === 0,
      "Reset leaked guests",
    );
    // Start the real managed DSH graph and exercise its plugin startup/stop hooks.
    const {
      DshRuntimeController,
      managedDshPaths,
      startDshNativeGateway,
    } = require(path.join(root, "runtime.cjs"));
    gateway = await startDshNativeGateway([
      {
        name: "amiba_native_attach",
        call: (args) => host.attach(args.packageName, args.instanceId),
      },
      {
        name: "amiba_native_detach",
        call: (args) =>
          args.lease
            ? host.detach(args.lease)
            : host.detachInstance(args.packageName, args.instanceId),
      },
      {
        name: "amiba_native_call",
        call: (args, context) =>
          host.call(args.lease, args.method, args.input, context),
      },
    ]);
    process.env.AMIBA_RUNTIME_GATEWAY_URL = gateway.url;
    process.env.AMIBA_RUNTIME_GATEWAY_TOKEN = gateway.token;
    const portProbe = http.createServer();
    await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
    process.env.AMIBA_DSH_DEV_PORT = String(portProbe.address().port);
    await new Promise((resolve) => portProbe.close(resolve));
    profileManifest = managedDshPaths().profileManifest;
    runtime = new DshRuntimeController();
    runtime.onStopped(() => host.reset());
    await runtime.ensureStarted();
    const liveLease = host.connect(packageName);
    assert(liveLease, "DSH did not activate the native plugin");
    await runtime.stop();
    let revoked = false;
    try {
      host.connect(packageName);
    } catch {
      revoked = true;
    }
    assert(revoked, "DSH stop retained the native plugin");
    await writeFile(
      path.join(output, "result.json"),
      JSON.stringify(
        {
          passed: true,
          checks: [
            "packed native+client+bundle",
            "real webview navigation",
            "snapshot",
            "input",
            "click",
            "screenshot",
            "uninstall destroys guest",
            "stale lease rejected",
            "replacement package navigation",
            "pending request cancelled",
            "reset destroys guests",
            "real DSH activates native plugin",
            "DSH stop revokes native plugin",
          ],
        },
        null,
        2,
      ),
    );
    console.log("Browser Electron smoke: 13 checks passed");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await runtime?.stop();
    await gateway?.stop();
    host?.reset();
    win?.destroy();
    server?.close();
    app.exit(process.exitCode || 0);
  }
});
