// Runs the real desktop with an isolated profile; makes no model or IM requests.
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
const profile = await mkdtemp(path.join(tmpdir(), "amiba-conversation-app-"));
const { PetService } = await import('../../../plugins/dsh-plugin-pets/lib/service.js');
const { catalog } = await import('../../../plugins/dsh-plugin-pets/lib/model.js');
await new PetService(path.join(profile, 'dsh/home/amiba-pets')).save({name:'Smoke pet', skinId:catalog().skins[0].id});

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
if (process.argv.includes('--development')) {
  const { workspacePackages } = await import('./dsh-client-dependencies.mjs');
  env.AMIBA_DSH_DEV_PROJECTS = JSON.stringify([...(await workspacePackages(root)).values()]
    .filter(pkg => pkg.directory.startsWith(path.join(root, 'plugins') + path.sep)).map(pkg => pkg.directory));
}
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
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Desktop debugger timed out: ${method}`));
    }, 15_000);
    pending.set(id, {
      resolve: value => { clearTimeout(timeout); resolve(value); },
      reject: error => { clearTimeout(timeout); reject(error); },
    });
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
  await wait(() => evaluate('!!document.querySelector("[data-testid=sidebar-item-steward]")'));
  await wait(() => evaluate('!!document.querySelector("[data-mofli-pet] svg")'));
  console.log('Empty page: installed pet renders by default');
  if (await evaluate('!![...document.querySelectorAll("button")].find(b => /^(宠物|Pets)$/.test(b.textContent.trim()))')) throw new Error('Pets still appears in main navigation');
  if (await evaluate('!![...document.querySelectorAll("button")].find(b => /^(大管家的对话|Steward conversations)$/.test(b.getAttribute("aria-label") || ""))')) throw new Error('Steward configuration remains in main navigation');
  await evaluate('[...document.querySelectorAll("button")].find(b=>/^(设置|Settings)$/.test(b.textContent.trim())).click()');
  await wait(() => evaluate('!!document.querySelector("[data-testid=settings-sidebar]")'));
  const openSetting = async pattern => {
    await evaluate(`[...document.querySelectorAll('[data-testid=settings-sidebar] button')].find(b => new RegExp(${JSON.stringify(pattern)}).test(b.textContent.trim())).click()`);
  };
  await openSetting('^(大管家|Steward)$');
  await wait(() => evaluate('!!document.querySelector("[data-steward-settings] select")'));
  await evaluate('const select=document.querySelector("[data-steward-settings] select");select.value="manual";select.dispatchEvent(new Event("change",{bubbles:true}))');
  await wait(() => evaluate('document.querySelector("[data-steward-settings] select")?.value === "manual" && !document.querySelector("[data-steward-settings] select").disabled'));
  await openSetting('^(宠物|Pets)$');
  await wait(() => evaluate('!!document.querySelector("[data-testid=pets-page]")'));
  console.log('Pet management opens from its registered settings section');
  await openSetting('^(大管家|Steward)$');
  await wait(() => evaluate('document.querySelector("[data-steward-settings] select")?.value === "manual"'));
  await evaluate('[...document.querySelectorAll("[data-steward-settings] button")].find(b=>/^(下条消息开始新对话|Start fresh with the next message)$/.test(b.textContent.trim())).click()');
  await wait(() => evaluate('/下次发送消息时将开启新对话|Your next message will start a new conversation/.test(document.body.innerText)'));
  await new Promise(resolve => setTimeout(resolve,350));
  // Some macOS background windows do not produce a compositor frame. Functional
  // assertions below still run; visual QA also has separate Electron previews.
  try {
    const screenshot = await call('Page.captureScreenshot', {format:'png', captureBeyondViewport:false});
    await writeFile('/tmp/amiba-live-steward-settings.png', Buffer.from(screenshot.data,'base64'));
  } catch (error) { console.warn(String(error)); }
  console.log('Steward live remote: cadence persisted across reopen; new conversation deferred until next message');
  async function remote(endpoint, args) {
    const response = await fetch(`http://127.0.0.1:${dshPort}/api/${endpoint}`, { method: 'POST', signal: AbortSignal.timeout(15_000), headers: {'content-type':'application/json'}, body: JSON.stringify({type:'client-request',rpcId:'conversation-smoke-'+Math.random(),method:endpoint,payload:{args}}) });
    const envelope = await response.json();
    if (!response.ok || !envelope.result?.ok) throw new Error('Remote failed: '+endpoint+' '+JSON.stringify(envelope));
    return envelope.result.value;
  }
  const skills = await remote('amibaSkills/list', {sessionId:null});
  const creator = skills.skills.find(skill => skill.name === 'skill-creator');
  if (!creator || creator.source !== 'bundled' || creator.editable || !creator.modelInvocable) throw new Error('Built-in skill-creator unavailable');
  const creatorDoc = await remote('amibaSkills/read', {name:'skill-creator',sessionId:null});
  if (!creatorDoc.document.includes('references/amiba-connectors.md')) throw new Error('Connector authoring guidance missing');
  const creatorFile = await remote('amibaSkills/readFile', {name:'skill-creator',path:'references/amiba-connectors.md',sessionId:null});
  if (!creatorFile.content) throw new Error('Built-in skill resources unreadable');
  console.log('Built-in skill-creator: bundled discovery, body and connector reference — passed');
  const pets = await remote('amibaPets/list', {});
  if (!Array.isArray(pets.pets)) throw new Error('Pet library remote unavailable');
  const studio = await remote('amibaPets/studio', {});
  if (!(await fetch(studio)).ok) throw new Error('Pet studio host unavailable');
  const memory = await remote('amibaMemory/status', {});
  if (!memory.state) throw new Error('Memory remote unavailable');
  console.log('Plugin host remotes: pet library, Studio HTTP host, memory status — passed');
  const before = await remote('amibaSteward/ensureStewardSession', {});
  const targets = await Promise.all([remote('amibaConversationEntry/prepareSubmit', {sessionId:before.sessionId}), remote('amibaConversationEntry/prepareSubmit', {sessionId:before.sessionId})]);
  if (targets[0] === before.sessionId || targets[0] !== targets[1]) throw new Error('Conversation did not advance exactly once');
  const after = await remote('amibaSteward/conversationSettings', {input:{action:'status'}});
  if (after.currentSessionId !== targets[0] || after.history.length !== 2 || after.pendingNewConversation) throw new Error('Incorrect persisted lifecycle after prepare');
  console.log('Live prepare-submit: concurrent calls advanced exactly once, retained previous history and cleared pending rollover');


} finally {
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
