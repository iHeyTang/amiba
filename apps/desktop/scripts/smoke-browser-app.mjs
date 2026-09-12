import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const root = fileURLToPath(new URL("../../..", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "amiba-browser-app-"));
async function port() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
const debugPort = await port(),
  dshPort = await port();
const env = {
  ...process.env,
  AMIBA_USER_DATA_DIR: profile,
  AMIBA_DSH_DEV_PORT: String(dshPort),
  AMIBA_DSH_RUNTIME_DIR: path.join(
    root,
    "packages/app-runtime/resources/dsh-runtime",
  ),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const child = spawn(
  require("electron"),
  [path.join(root, "apps/desktop"), `--remote-debugging-port=${debugPort}`],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
child.stdout.on("data", (value) => {
  logs += value;
});
child.stderr.on("data", (value) => {
  logs += value;
});
const pageServer = http.createServer((_req, response) =>
  response.end(
    '<html><title>Independent browser</title><body style="background:white;color:#222;font:24px sans-serif;padding:30px"><h1>Independent browser plugin</h1><p>Loaded through the installed workbench plugin.</p></body></html>',
  ),
);
await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${pageServer.address().port}/`;
let socket;
const pending = new Map();
let next = 0;
async function wait(check) {
  for (let i = 0; i < 120; i++) {
    const result = await check();
    if (result) return result;
    if (child.exitCode !== null)
      throw new Error("App exited: " + logs.slice(-5000));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("App UI timeout: " + logs.slice(-5000));
}
function call(method, params = {}) {
  const id = ++next;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
try {
  const target = await wait(async () => {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      ).json();
      return targets.find(
        (target) =>
          target.type === "page" &&
          /out\/renderer\/index.html/.test(target.url),
      );
    } catch {
      return null;
    }
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.on("message", (bytes) => {
    const message = JSON.parse(String(bytes));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error
      ? request.reject(new Error(JSON.stringify(message.error)))
      : request.resolve(message.result);
  });
  await new Promise((resolve) => socket.once("open", resolve));
  await wait(() => evaluate("(document.body?.innerText.length ?? 0) > 50"));
  const created = await wait(async () => {
    try {
      const response = await fetch(
        `http://127.0.0.1:${dshPort}/api/session.create`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "client-request",
            rpcId: "browser-smoke",
            method: "session.create",
            payload: { sessionId: "browser-smoke", cwd: profile },
          }),
        },
      );
      const result = await response.json();
      return result.result?.ok ? result.result.value : null;
    } catch {
      return null;
    }
  });
  await evaluate(
    `window.amiba.desktopPet.openConversation(${JSON.stringify(created.sessionId)})`,
  );
  await wait(() =>
    evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => /^(Open browser|打开浏览器)$/.test(b.getAttribute('aria-label') || b.title)) && true",
    ),
  );
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>/^(Open browser|打开浏览器)$/.test(b.getAttribute('aria-label') || b.title)).click()",
  );
  await wait(() =>
    evaluate(
      "document.querySelector('[data-embedded-browser-workspace]') && true",
    ),
  );
  await wait(() =>
    evaluate(
      "Array.from(document.querySelectorAll('webview')).some(guest => { try { return guest.getURL() === 'about:blank' && !guest.isLoading(); } catch { return false; } })",
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  await evaluate(
    "document.querySelector('[data-embedded-browser-workspace] input').focus()",
  );
  await call("Input.insertText", { text: pageUrl });
  await evaluate(
    "document.querySelector('[data-embedded-browser-workspace] form').requestSubmit()",
  );
  await wait(() =>
    evaluate(
      `Array.from(document.querySelectorAll('webview')).some(guest => { try { return guest.getURL() === ${JSON.stringify(pageUrl)} && !guest.isLoading(); } catch { return false; } })`,
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(
    path.join(root, "apps/desktop/out/browser-smoke/workbench.png"),
    Buffer.from(screenshot.data, "base64"),
  );
  console.log("Integrated workbench browser UI passed");
} finally {
  pageServer.close();
  socket?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => child.kill("SIGKILL"), 6000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await rm(profile, { recursive: true, force: true });
}
