import assert from "node:assert/strict";
import { createServer } from "node:http";
import { app, BrowserWindow, type IpcMainInvokeEvent, type WebContentsView } from "electron";
import { createEmbeddedPageHandler } from "../../src/main/embedded-page";

app.setPath("userData", process.env.AMIBA_PAGE_SMOKE_HOME!);
const seen: string[] = [];
const server = createServer((req, res) => {
  seen.push(req.headers.cookie ?? "");
  res.setHeader("Content-Type", "text/html");
  if (req.url === "/login") res.setHeader("Set-Cookie", "session=fixture; HttpOnly; SameSite=Lax; Path=/");
  res.end("<!doctype html><title>Local management fixture</title><h1>Native management page</h1>");
});
let window: BrowserWindow | undefined;
async function run() {
try {
  await app.whenReady();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { sandbox: true } });
  await window.loadURL("about:blank");
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame } as IpcMainInvokeEvent;
  const handle = createEmbeddedPageHandler();
  await assert.rejects(handle(event, { action: "mount", id: "bad", url: "https://example.com" }));
  await handle(event, { action: "mount", id: "first", url: `http://127.0.0.1:${port}/login` });
  assert.equal(window.contentView.children.length, 1);
  const first = window.contentView.children[0] as WebContentsView;
  const visibility: boolean[] = [];
  const setVisible = first.setVisible.bind(first);
  first.setVisible = (visible: boolean) => { visibility.push(visible); setVisible(visible); };
  await handle(event, { action: "bounds", id: "first", bounds: { x: 160, y: 100, width: 600, height: 400 } });
  assert.deepEqual(first.getBounds(), { x: 160, y: 100, width: 600, height: 400 });
  assert.equal(visibility.at(-1), true);
  await handle(event, { action: "bounds", id: "first", bounds: null });
  assert.equal(visibility.at(-1), false);
  const contents = first.webContents;
  await handle(event, { action: "unmount", id: "first" });
  assert.equal(window.contentView.children.length, 0);
  if (!contents.isDestroyed()) await new Promise(resolve => contents.once("destroyed", resolve));
  await handle(event, { action: "mount", id: "second", url: `http://127.0.0.1:${port}/check` });
  assert.ok(seen.some(cookie => cookie.includes("session=fixture")), "login cookie did not survive view recreation");
  await window.loadURL("about:blank?reload");
  assert.equal(window.contentView.children.length, 0, "native view survived host navigation");
  console.log("PASS: native WebContentsView load, resize, hide, destroy, cookie retention and host navigation cleanup");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  window?.destroy();
  await new Promise<void>(resolve => server.close(() => resolve()));
  app.exit(process.exitCode ?? 0);
}
}
void run();
