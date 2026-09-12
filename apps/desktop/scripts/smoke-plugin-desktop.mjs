import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "amiba-plugin-app-"));
async function port() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
const debugPort = await port(),
  dshPort = await port();
const author = process.argv.includes("--author");
const native = process.argv.includes("--native") || process.argv.includes("--compat");
const { workspacePackages } = await import("./dsh-client-dependencies.mjs");
const authorProjects = author ? [...(await workspacePackages(root)).values()].filter(pkg => pkg.directory.startsWith(path.join(root, "plugins") + path.sep)).map(pkg => pkg.directory) : undefined;
const env = {
  ...process.env,
  AMIBA_USER_DATA_DIR: profile,
  ...(process.argv.includes("--browse-directory") ? { SSH_CONNECTION: "amiba-directory-test" } : {}),
  ...(authorProjects ? { AMIBA_DSH_DEV_PROJECTS: JSON.stringify(authorProjects) } : {}),
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
const project = path.join(profile, "dsh-plugin-probe");
let cli;
let cliLogs = "";
let socket;
const pending = new Map();
let next = 0;
async function wait(check) {
  for (let i = 0; i < 60; i++) {
    const result = await check();
    if (result) return result;
    if (child.exitCode !== null)
      throw new Error("App exited: " + logs.slice(-5000));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (socket?.readyState === 1) logs += JSON.stringify(await evaluate("(async()=>({hmr:Array.from(window.__probeCtx?.loader.entries()??[]).filter(e=>e.options.name.includes('hmr')||e.options.name.includes('probe')).map(e=>({name:e.options.name,state:e.fiber?.state,inject:e.fiber?.inject})),frames:window.__probeFrames?.map(s=>{try{const f=JSON.parse(s);return {type:f.type,id:f.id,rev:f.rev}}catch{return s}}),diagnostics:(await window.amiba.agentDiagnostics.logs({limit:100})).entries.filter(e=>/PROBE|DOWNLOAD|hmr|error/i.test(e.message))}))()").catch(String));
  logs += "\nNative events: " + await readFile(path.join(profile,"native-events.jsonl"),"utf8").catch(String);
  throw new Error("App UI timeout: " + logs.slice(-18000) + "\nCLI: " + cliLogs);
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
    if (!message.id) { if (message.method?.startsWith("Browser.download") || message.method === "Network.loadingFailed" || message.method === "Runtime.consoleAPICalled" || message.method === "Runtime.exceptionThrown" || message.method === "Log.entryAdded" || (message.method === "Network.responseReceived" && /dsh-plugin-probe|session.export/.test(message.params.response.url))) logs += JSON.stringify(message.params) + "\n"; return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error
      ? request.reject(new Error(JSON.stringify(message.error)))
      : request.resolve(message.result);
  });
  await new Promise((resolve) => socket.once("open", resolve));
  await call("Runtime.enable");
  await call("Log.enable");
  await call("Network.enable");
  await wait(() => evaluate("Boolean(document.querySelector('[data-amiba-product-shell]'))"));
  assert.equal(await evaluate("location.protocol"), "file:");
  const home = path.join(profile, "dsh/home");
  const installedManifest = path.join(home, "profiles/amiba-desktop/package.json");
  const before = await readFile(installedManifest, "utf8");
  await mkdir(path.join(project, "src"), { recursive: true });
  await symlink(path.join(root, "apps/desktop/node_modules"), path.join(project, "node_modules"), "dir");
  await writeFile(path.join(project, "package.json"), JSON.stringify({ name: "dsh-plugin-probe", version: "0.0.0", type: "module", main: "lib/index.js", exports: { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" }, scripts: { build: "tsc -p tsconfig.build.json && vite build" + (native ? " && vite build --config vite.native.config.mjs" : "") }, dsh: { ...(native ? { native: "./lib/native.cjs" } : {}), client: { inject: ["@deepseek-ai/dsh-client-runtime"], platform: "web" } } }));
  await writeFile(path.join(project, "tsconfig.build.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", rootDir: "src", outDir: "lib", skipLibCheck: true }, include: ["src"] }));
  await writeFile(path.join(project, "vite.config.mjs"), `export default { build: { emptyOutDir:false, lib: {entry:'src/client.ts',formats:['cjs'],fileName:()=> 'client.js'}, rollupOptions: {output: {banner:'window.__ModuleLoader__.load({id:"dsh-plugin-probe",factory:(require)=>{const module={exports:{}};const exports=module.exports;',footer:'return module.exports;}});'}}}}`);
  const hostSource = version => `export function apply(ctx: any) { ctx.effect(() => { console.log('AMIBA_PROBE_HOST_${version}'); return () => console.log('AMIBA_PROBE_DISPOSE_${version}'); }); }`;
  const clientSource = version => `${process.argv.includes("--compat") ? "export const inject = [\"slots\", \"settingsScope\", \"layout\", \"sessions\", \"sessionLogDownload\"];" : ""}export function apply(ctx: any) { (window as any).__probeCtx=ctx; ctx.effect(() => { const node=document.createElement('div');node.id='amiba-plugin-probe';node.textContent='client-${version}';document.body.append(node);return ()=>node.remove(); }); }`;
  const nativeEvents = path.join(profile, "native-events.jsonl");
  const nativeSource = version => `import {appendFileSync} from 'node:fs';${process.argv.includes("--compat") ? "import {session,dialog} from 'electron';" : ""}export function create(){appendFileSync(${JSON.stringify(nativeEvents)},'native-start-${version}\\n');${process.argv.includes("--compat") ? `const originalPicker=dialog.showOpenDialog;dialog.showOpenDialog=async(...args)=>{const options=args.at(-1);if(!options?.properties?.includes('openDirectory'))return originalPicker.apply(dialog,args);appendFileSync(${JSON.stringify(nativeEvents)},'picker-options '+JSON.stringify({defaultPath:options.defaultPath,properties:options.properties})+'\\n');return {canceled:false,filePaths:[${JSON.stringify(path.join(profile,'native-picked'))}]};};const save=(_event,item)=>{item.setSavePath(${JSON.stringify(path.join(profile,"downloads"))}+'/'+item.getFilename());item.on('done',(_event,state)=>appendFileSync(${JSON.stringify(nativeEvents)},'download-'+state+' '+item.getReceivedBytes()+'/'+item.getTotalBytes()+' '+item.getSavePath()+'\\n'));};session.defaultSession.on('will-download',save);` : ""}return {call(){return 'native-${version}'},rendererCall(){return 'native-${version}'},dispose(){${process.argv.includes("--compat") ? "session.defaultSession.removeListener('will-download',save);dialog.showOpenDialog=originalPicker;" : ""}appendFileSync(${JSON.stringify(nativeEvents)},'native-stop-${version}\\n')}}}`;

  if (native) {
    await writeFile(path.join(project, "src/native.ts"), nativeSource(1));
    await writeFile(path.join(project, "vite.native.config.mjs"), `export default {build:{emptyOutDir:false,lib:{entry:'src/native.ts',formats:['cjs'],fileName:()=> 'native.cjs'},rollupOptions:{external:['node:fs','electron']}}}`);
  }
  const source = version => native ? `export const inject=['amibaRuntimeGateway']; export async function apply(ctx:any) { let lease:string|undefined;let disposed=false;ctx.effect(()=>async()=>{disposed=true;if(lease)await ctx.amibaRuntimeGateway.call('amiba_native_detach',{lease})});lease=await ctx.amibaRuntimeGateway.call('amiba_native_attach',{packageName:'dsh-plugin-probe',instanceId:'probe-'+Date.now()});if(disposed){await ctx.amibaRuntimeGateway.call('amiba_native_detach',{lease});return}console.log('AMIBA_PROBE_HOST_${version}'); }` : hostSource(version);
  await writeFile(path.join(project, "src/index.ts"), source(1));
  await writeFile(path.join(project, "src/client.ts"), clientSource(1));
  cli = spawn(process.execPath, [process.env.AMIBA_SMOKE_CLI || path.join(root, "apps/cli/dist/cli.js"), "--dsh-home", home, "plugin", "dev"], { cwd: project, env: {...process.env}, stdio: ["ignore", "pipe", "pipe"] });
  cli.stdout.on("data", chunk => { cliLogs += chunk; });
  cli.stderr.on("data", chunk => { cliLogs += chunk; });
  await wait(async () => {
    if (cli.exitCode !== null) throw new Error("Plugin CLI failed: " + cliLogs);
    try { return await evaluate("document.querySelector('#amiba-plugin-probe')?.textContent === 'client-1'"); } catch { return false; }
  });
  await evaluate("window.__amibaHmrProbe = 42; window.__probeFrames=[]; const probeSse = new EventSource('/plugins/events'); probeSse.onmessage=e=>window.__probeFrames.push(e.data); probeSse.onerror=e=>window.__probeFrames.push('error')");
  const runtimeBefore = await evaluate("window.amiba.agentDiagnostics.status()");
  await writeFile(path.join(project, "src/index.ts"), source(2));
  await writeFile(path.join(project, "src/client.ts"), clientSource(2));
  await wait(() => evaluate("document.querySelector('#amiba-plugin-probe')?.textContent === 'client-2'"));
  await wait(async () => (await evaluate("window.amiba.agentDiagnostics.logs({search:'AMIBA_PROBE_HOST_2'})")).entries.length > 0);
  assert.equal((await evaluate("window.amiba.agentDiagnostics.status()")).pid, runtimeBefore.pid, "host HMR must preserve the DSH process");
  assert.equal(await evaluate("window.__amibaHmrProbe"), 42, "ordinary client HMR must preserve the document");
  assert.equal(await evaluate("document.querySelectorAll('#amiba-plugin-probe').length"), 1, "old plugin DOM must be disposed");
  assert.equal(await readFile(installedManifest, "utf8"), before);
  if (native) {
    assert.equal(await evaluate("(async()=>window.amiba.nativeExtensions.call(await window.amiba.nativeExtensions.connect('dsh-plugin-probe'),'version'))()"), "native-1");
    await writeFile(path.join(project, "src/native.ts"), nativeSource(2));
    await wait(async () => { try { return await evaluate("(async()=>window.amiba.nativeExtensions.call(await window.amiba.nativeExtensions.connect('dsh-plugin-probe'),'version'))()") === 'native-2'; } catch { return false; } });
    assert.match(await readFile(nativeEvents, 'utf8'), /native-stop-1/);
    assert.equal((await evaluate("window.amiba.agentDiagnostics.status()")).pid, runtimeBefore.pid);
  }
  if (process.argv.includes("--compat")) {
    const directorySessionsBefore = await evaluate("window.__probeCtx.sessions.list.getSnapshot().ids");
    await evaluate(`(() => {
      window.__directoryOff = window.__probeCtx.slots.register({
        name:'conversation.hero.workspace.directoryFlow', id:'compat-directory', priority:-100,
      }, owner => { window.__directoryOwner=owner; return owner.open ? 'COMPAT_DIRECTORY_OPEN' : null; });
    })()`);
    const directoryButton = "document.querySelector('[role=group][aria-label=\"Execution context\"] button, [role=group][aria-label=\"执行上下文\"] button')";
    await wait(() => evaluate(`Boolean(${directoryButton})`));
    await evaluate(`${directoryButton}.click()`);
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_DIRECTORY_OPEN')"));
    await evaluate("window.__oldDirectoryOwner=window.__directoryOwner;window.__directoryOwner.onCancel();void 0");
    await wait(() => evaluate("!document.body.textContent.includes('COMPAT_DIRECTORY_OPEN')"));
    await evaluate(`${directoryButton}.click()`);
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_DIRECTORY_OPEN')"));
    await evaluate("window.__oldDirectoryOwner.onPicked('/stale-directory')");
    assert.ok(await evaluate("document.body.textContent.includes('COMPAT_DIRECTORY_OPEN')"), "old callback must not finish the new flow");
    await evaluate(`window.__directoryOwner.onPicked(${JSON.stringify(profile)})`);
    await wait(() => evaluate(`!document.body.textContent.includes('COMPAT_DIRECTORY_OPEN') && ${directoryButton}?.title===${JSON.stringify(profile)}`));
    assert.deepEqual(await evaluate("window.__probeCtx.sessions.list.getSnapshot().ids"), directorySessionsBefore, "choosing a Home path must not create a session");
    await writeFile(path.join(tmpdir(), "amiba-directory-home.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
    await evaluate("window.__directoryOff();void 0");
    assert.ok(await evaluate("window.__probeCtx.slots.entriesOfSlot('conversation.hero.workspace.directoryFlow').length > 0 && window.__probeCtx.slots.entriesOfSlot('sidebar.workspaces.directoryFlow').length > 0"), "default picker registrations must remain in both directory slots");
    console.log("Home directory slot passed real registration, cancellation, reopen, stale callback rejection and existing path adoption.");
    if (process.argv.includes("--browse-directory")) {
      await evaluate(`${directoryButton}.click()`);
      await wait(() => evaluate("Boolean(document.querySelector('[role=dialog]'))"));
      await writeFile(path.join(tmpdir(), "amiba-directory-browser.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
      const directoryStyle = await evaluate("({background:getComputedStyle(document.querySelector('[role=dialog]')).backgroundColor,foreground:getComputedStyle(document.querySelector('[role=dialog]')).color,shellAlias:getComputedStyle(document.querySelector('[data-amiba-product-shell]')).getPropertyValue('--dsw-alias-bg-layer-2')})");
      assert.notEqual(directoryStyle.background, 'rgba(0, 0, 0, 0)', "browser picker must have an opaque dialog background");
      assert.notEqual(directoryStyle.background, directoryStyle.foreground);
      assert.equal(directoryStyle.shellAlias, '', "official aliases must stay local to the plugin dialog");
      await evaluate("Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(n=>n.textContent==='Cancel'||n.textContent==='取消').click()");
      await wait(() => evaluate("!document.querySelector('[role=dialog]')"));
      await evaluate(`${directoryButton}.click()`);
      await wait(() => evaluate("Boolean(document.querySelector('button[aria-label=\"Edit path\"]'))"));
      await evaluate("document.querySelector('button[aria-label=\"Edit path\"]').click()");
      await wait(() => evaluate("Boolean(document.querySelector('input[aria-label=\"Edit path\"]'))"));
      await evaluate(`(() => {const input=document.querySelector('input[aria-label="Edit path"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(profile)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await evaluate("document.querySelector('input[aria-label=\"Edit path\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
      await wait(() => evaluate(`!document.querySelector('input[aria-label="Edit path"]') && document.querySelector('[role=dialog]')?.textContent.includes(${JSON.stringify(path.basename(profile))})`));
      await evaluate("Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(n=>n.textContent==='New folder').click()");
      await wait(() => evaluate("Boolean(document.querySelector('input[aria-label=\"Folder name\"]'))"));
      await writeFile(path.join(tmpdir(), "amiba-directory-browser-create.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
      await evaluate("(() => {const input=document.querySelector('input[aria-label=\"Folder name\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'browser-created');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await evaluate("document.querySelector('input[aria-label=\"Folder name\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
      await wait(() => evaluate("!document.querySelector('input[aria-label=\"Folder name\"]') && document.querySelector('[role=dialog]')?.textContent.includes('browser-created')"));
      const createdBrowserPath = await realpath(path.join(profile, "browser-created"));
      await wait(() => evaluate("Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).some(n=>n.textContent==='Open'&&!n.disabled)"));
      await evaluate("Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(n=>n.textContent==='Open').click()");
      await wait(() => evaluate(`!document.querySelector('[role=dialog]') && ${directoryButton}?.title.endsWith('/browser-created')`));
      assert.equal(await realpath(await evaluate(`${directoryButton}.title`)), createdBrowserPath);
      assert.deepEqual(await evaluate("window.__probeCtx.sessions.list.getSnapshot().ids"), directorySessionsBefore);
      console.log("Official browser picker passed local styles, cancellation, path editing, real directory creation and Home selection without creating a session.");
    } else {
    // Exercise the installed native occupant through preload + main IPC, replacing
    // only the OS-dialog boundary in the temporary native fixture.
    await mkdir(path.join(profile, "native-picked"), { recursive: true });
    await evaluate(`${directoryButton}.click()`);
    await wait(() => evaluate(`${directoryButton}?.title===${JSON.stringify(path.join(profile, "native-picked"))}`));
    const pickerEvent = (await readFile(nativeEvents, "utf8")).split("\n").find(line=>line.startsWith("picker-options "));
    assert.ok(pickerEvent, "default picker must reach the existing Electron dialog boundary");
    const pickerOptions = JSON.parse(pickerEvent.slice("picker-options ".length));
    assert.equal(pickerOptions.defaultPath, profile, "native picker must retain the previously selected starting path");
    assert.ok(pickerOptions.properties.includes("openDirectory"));
    assert.deepEqual(await evaluate("window.__probeCtx.sessions.list.getSnapshot().ids"), directorySessionsBefore);
    console.log("Default native picker passed installed component, platform callback and main IPC with preserved defaultPath (OS dialog response stubbed).");

    }
    // Real SlotCore + module-loader + renderer integration on the file: surface.
    const namespace = await evaluate(`(async () => {
      const ctx = window.__probeCtx;
      const describe = ctx.settingsScope.describe();
      await describe.ensure();
      const snapshot = describe.getSnapshot();
      if (!snapshot.view) throw new Error("Settings mirror unavailable: " + JSON.stringify(snapshot));
      return snapshot.view.namespaces[0]?.ns;
    })()`);
    assert.ok(namespace, "managed Host must serve a real settings namespace");
    await evaluate(`(() => {
      const ctx = window.__probeCtx;
      window.__compatDisposers = [
        ctx.slots.register({name:'settings.plugins.tab',id:'compat-probe',label:'Compatibility probe'}, () => 'COMPAT_TAB_CONTENT'),
        ctx.slots.register({name:'settings.plugin.item',id:'compat-card',priority:-1,key:${JSON.stringify(namespace)}}, () => 'COMPAT_CONFIG_CARD'),
        ctx.slots.register({name:'sidebar.footer.action',id:'compat-footer'}, ({wide}) => wide ? 'COMPAT_FOOTER_WIDE' : 'COMPAT_FOOTER_NARROW'),
      ];
      ctx.layout.openSettings('plugins');
    })()`);
    await wait(() => evaluate("Array.from(document.querySelectorAll('[role=tab]')).some(n=>n.textContent==='Compatibility probe')"));
    await evaluate("Array.from(document.querySelectorAll('[role=tab]')).find(n=>n.textContent==='Compatibility probe').click()");
    await wait(() => evaluate("document.querySelector('[role=tabpanel]:not([hidden])')?.textContent.includes('COMPAT_TAB_CONTENT')"));
    await evaluate("Array.from(document.querySelectorAll('[role=tab]')).find(n=>/Configuration|配置/.test(n.textContent)).click()");
    await wait(() => evaluate("document.querySelector('[role=tabpanel]:not([hidden])')?.textContent.includes('COMPAT_CONFIG_CARD')"));
    await evaluate("window.__probeCtx.layout.openChat()");
    await wait(() => evaluate("/COMPAT_FOOTER_(WIDE|NARROW)/.test(document.body.textContent)"));
    const wasWide = await evaluate("document.body.textContent.includes('COMPAT_FOOTER_WIDE')");
    await evaluate("window.__probeCtx.layout.toggleSidebar()");
    await wait(() => evaluate(`document.body.textContent.includes(${JSON.stringify(wasWide ? 'COMPAT_FOOTER_NARROW' : 'COMPAT_FOOTER_WIDE')})`));
    await evaluate("window.__probeCtx.layout.toggleSidebar();window.__probeCtx.layout.openSettings('plugins')");
    await wait(() => evaluate("Array.from(document.querySelectorAll('[role=tab]')).some(n=>n.textContent==='Compatibility probe')"));
    await evaluate("Array.from(document.querySelectorAll('[role=tab]')).find(n=>n.textContent==='Compatibility probe').click()");
    await evaluate("window.__compatDisposers.forEach(dispose=>dispose());delete window.__compatDisposers");
    await wait(() => evaluate("!document.body.textContent.includes('COMPAT_TAB_CONTENT') && /inventory|清单/i.test(document.querySelector('[role=tab][aria-selected=true]')?.textContent ?? '')"));
    await evaluate("Array.from(document.querySelectorAll('[role=tab]')).find(n=>/Configuration|配置/.test(n.textContent)).click()");
    await wait(() => evaluate("Array.from(document.querySelectorAll('form')).some(n=>/Agent execution|Agent 执行/.test(n.getAttribute('aria-label')??''))"));
    await evaluate("window.__agentSettings=window.__probeCtx.settingsScope.bind({namespace:'agent-loop'});void 0");
    await wait(() => evaluate("window.__agentSettings.getSnapshot().status==='ready'"));
    const beforeLimit=await evaluate("window.__agentSettings.getSnapshot().value.maxParallelToolCalls");
    const nextLimit=beforeLimit===2?3:2;
    await evaluate(`(() => {
      const form=Array.from(document.querySelectorAll('form')).find(n=>/Agent execution|Agent 执行/.test(n.getAttribute('aria-label')??''));
      window.__agentForm=form;
      const input=form.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(nextLimit))});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await wait(() => evaluate("!window.__agentForm.querySelector('button[type=submit]').disabled"));
    assert.equal(await evaluate("window.__agentSettings.getSnapshot().value.maxParallelToolCalls"),beforeLimit,"editing must not write Host settings");
    await evaluate("window.__agentForm.querySelector('button[type=submit]').click()");
    await wait(() => evaluate(`window.__agentSettings.getSnapshot().value.maxParallelToolCalls===${nextLimit} && window.__agentForm.querySelector('button[type=submit]').disabled`));
    await evaluate("window.__agentForm.querySelector('input').parentElement.querySelector('button').click()");
    await wait(() => evaluate("!window.__agentForm.querySelector('button[type=submit]').disabled"));
    await evaluate("window.__agentForm.querySelector('button[type=submit]').click()");
    await wait(() => evaluate("!Object.hasOwn(window.__agentSettings.getSnapshot().user??{},'maxParallelToolCalls') && window.__agentForm.querySelector('button[type=submit]').disabled"));
    await writeFile(path.join(tmpdir(), "amiba-plugin-config-cards.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
    for (const spec of [
      {namespace:"shell",label:"Shell execution|Shell 执行",field:"timeoutMs",text:"61000",value:61000},
      {namespace:"web-search-deepseek",label:"DeepSeek web search|DeepSeek 网页搜索",field:"baseURL",text:"https://example.test",value:"https://example.test"},
    ]) {
      await evaluate(`window.__cardScope=window.__probeCtx.settingsScope.bind({namespace:${JSON.stringify(spec.namespace)}});window.__cardForm=Array.from(document.querySelectorAll('form')).find(n=>new RegExp(${JSON.stringify(spec.label)}).test(n.getAttribute('aria-label')??''));void 0`);
      await wait(() => evaluate("window.__cardScope.getSnapshot().status==='ready' && Boolean(window.__cardForm)"));
      const before=await evaluate(`window.__cardScope.getSnapshot().value[${JSON.stringify(spec.field)}]`);
      await evaluate(`(() => {const input=window.__cardForm.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(spec.text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await wait(() => evaluate("!window.__cardForm.querySelector('button[type=submit]').disabled"));
      assert.equal(await evaluate(`window.__cardScope.getSnapshot().value[${JSON.stringify(spec.field)}]`),before);
      await evaluate("window.__cardForm.querySelector('button[type=submit]').click()");
      await wait(() => evaluate(`window.__cardScope.getSnapshot().value[${JSON.stringify(spec.field)}]===${JSON.stringify(spec.value)} && window.__cardForm.querySelector('button[type=submit]').disabled`));
      await evaluate("window.__cardForm.querySelector('input').parentElement.querySelector('button').click()");
      await wait(() => evaluate("!window.__cardForm.querySelector('button[type=submit]').disabled"));
      await evaluate("window.__cardForm.querySelector('button[type=submit]').click()");
      await wait(() => evaluate(`!Object.hasOwn(window.__cardScope.getSnapshot().user??{},${JSON.stringify(spec.field)}) && window.__cardForm.querySelector('button[type=submit]').disabled`));
    }
    assert.ok(await evaluate("window.__cardForm.querySelector('input[type=password]')?.value===''") , "search key must never be prefilled");
    await evaluate("window.__cardForm.scrollIntoView({block:'end'})");
    await writeFile(path.join(tmpdir(), "amiba-plugin-search-config.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
    console.log("All three official config forms passed actual Host save/reset; the search key remains blank.");

    const downloads = path.join(profile, "downloads");
    await mkdir(downloads, { recursive: true });
    // The native fixture saves via Electron DownloadItem, avoiding a save dialog.
    await evaluate(`(async () => {
      const ctx = window.__probeCtx;
      const id = await ctx.sessions.create({cwd:${JSON.stringify(profile)}});
      ctx.layout.openChat();
      ctx.sessions.open(id);
      window.__compatSessionId = id;
      await ctx.sessionLogDownload.download(id);
      const state = ctx.sessionLogDownload.store.getSnapshot().bySession[id];
      if (state.status !== 'success') throw new Error(JSON.stringify(state));
    })()`);
    const zip = await wait(async () => {
      const files = await readdir(downloads);
      return files.find(name => name.endsWith('.zip'));
    });
    const bytes = await readFile(path.join(downloads, zip));
    assert.equal(bytes.subarray(0, 2).toString(), "PK", "browser must save a ZIP, not an HTML error");
    assert.ok(bytes.length > 22, "ZIP must include the session archive");
    assert.ok(await evaluate("Boolean(document.querySelector('[data-amiba-product-shell]'))"), "download must preserve the product page");
    console.log("Native session ZIP download passed on Desktop file: with an actual saved archive.");
    await wait(() => evaluate("Boolean(document.querySelector('[role=dialog]'))"));
    await evaluate("Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(n=>n.textContent==='Close'||n.textContent==='关闭').click()");
    await wait(() => evaluate("!document.querySelector('[role=dialog]')"));
    await evaluate(`(() => {
      window.__compatViewOff = window.__probeCtx.slots.register({
        name:'conversation.view', id:'compat-view', label:'Compatibility view',
        inject: (sessionId) => ({injectedSessionId:sessionId}),
      }, ({sessionId,injectedSessionId}) => 'COMPAT_VIEW:' + sessionId + ':' + injectedSessionId);
    })()`);
    await wait(() => evaluate("Array.from(document.querySelectorAll('[role=tab]')).some(n=>n.textContent==='Compatibility view')"));
    await evaluate("window.__nativeChatNode=document.querySelector('main[role=tabpanel]');Array.from(document.querySelectorAll('[role=tab]')).find(n=>n.textContent==='Compatibility view').click()");
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_VIEW:'+window.__compatSessionId+':'+window.__compatSessionId)"));
    assert.ok(await evaluate("window.__nativeChatNode.isConnected && window.__nativeChatNode.hidden"), "native chat stays mounted while viewing plugin");
    await writeFile(path.join(tmpdir(), "amiba-conversation-plugin-view.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
    await evaluate("window.__compatViewOff();delete window.__compatViewOff");
    await wait(() => evaluate("window.__nativeChatNode.isConnected && !window.__nativeChatNode.hidden && !document.body.textContent.includes('COMPAT_VIEW:') && !Array.from(document.querySelectorAll('[role=tab]')).some(n=>n.textContent==='Compatibility view')"));
    await writeFile(path.join(tmpdir(), "amiba-conversation-native-view.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
    console.log("Conversation view passed: actual session props/injection, selection, preserved native chat and unload fallback.");
    let projectFolder = path.join(profile, "directory-project");
    let extraFolder = path.join(profile, "directory-extra");
    await mkdir(projectFolder, { recursive: true });
    await mkdir(extraFolder, { recursive: true });
    projectFolder = await realpath(projectFolder);
    extraFolder = await realpath(extraFolder);
    await evaluate(`(() => {
      window.__projectDirectoryOff = window.__probeCtx.slots.register({
        name:'sidebar.workspaces.directoryFlow', id:'compat-project-directory', priority:-100,
      }, owner => { window.__projectDirectoryOwner=owner; return owner.open ? 'COMPAT_PROJECT_DIRECTORY_OPEN' : null; });
      const toggle=document.querySelector('button[aria-label="Open workbench"],button[aria-label="打开工作台"]');
      if(toggle) toggle.click();
    })()`);
    await wait(() => evaluate("Boolean(document.querySelector('button[aria-label=\"Show file tree\"],button[aria-label=\"显示文件目录\"]'))"));
    await evaluate("document.querySelector('button[aria-label=\"Show file tree\"],button[aria-label=\"显示文件目录\"]').click()");
    await wait(() => evaluate("Boolean(document.querySelector('[data-workspace-project-strip] button[aria-haspopup=menu]'))"));
    await evaluate("document.querySelector('[data-workspace-project-strip] button[aria-haspopup=menu]').click()");
    await wait(() => evaluate("Array.from(document.querySelectorAll('[role=menuitem]')).some(n=>n.textContent==='New project from folder'||n.textContent==='从文件夹新建项目')"));
    await evaluate("Array.from(document.querySelectorAll('[role=menuitem]')).find(n=>n.textContent==='New project from folder'||n.textContent==='从文件夹新建项目').click()");
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_PROJECT_DIRECTORY_OPEN')"));
    await evaluate(`window.__projectDirectoryOwner.onPicked(${JSON.stringify(projectFolder)})`);
    await wait(() => evaluate(`(async()=>!document.body.textContent.includes('COMPAT_PROJECT_DIRECTORY_OPEN') && await window.amiba.workspaces.getCurrent(window.__compatSessionId)===${JSON.stringify(projectFolder)})()`));
    const createdProject = await evaluate("window.amiba.workspaceDevelopment.ensureProject(window.__compatSessionId)");
    assert.deepEqual(createdProject.folders, [projectFolder], "new project must keep the actual selected folder");
    await wait(() => evaluate("Boolean(document.querySelector('[data-workspace-project-add]:not(:disabled)'))"));
    await evaluate("document.querySelector('[data-workspace-project-add]').click()");
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_PROJECT_DIRECTORY_OPEN')"));
    await evaluate("window.__projectDirectoryOwner.onCancel()");
    await wait(() => evaluate("!document.body.textContent.includes('COMPAT_PROJECT_DIRECTORY_OPEN')"));
    assert.deepEqual((await evaluate("window.amiba.workspaceDevelopment.ensureProject(window.__compatSessionId)")).folders, [projectFolder], "cancel must not add a project folder");
    await evaluate("document.querySelector('[data-workspace-project-add]').click()");
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_PROJECT_DIRECTORY_OPEN')"));
    await evaluate(`window.__projectDirectoryOwner.onPicked(${JSON.stringify(extraFolder)})`);
    await wait(() => evaluate(`(async()=>!document.body.textContent.includes('COMPAT_PROJECT_DIRECTORY_OPEN') && await window.amiba.workspaces.getCurrent(window.__compatSessionId)===${JSON.stringify(extraFolder)})()`));
    const extendedProject = await evaluate("window.amiba.workspaceDevelopment.ensureProject(window.__compatSessionId)");
    assert.equal(extendedProject.id, createdProject.id, "add-folder must retain project identity");
    assert.deepEqual(extendedProject.folders, [projectFolder, extraFolder]);
    await writeFile(path.join(tmpdir(), "amiba-directory-project.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
    await evaluate("window.__projectDirectoryOff();void 0");
    console.log("Project directory slot passed real project creation, cancellation, add-folder and session location binding.");
    console.log("Compatibility slots passed: real plugin tab selection, Host-keyed config card, removal and inventory fallback.");
  }
  await evaluate("window.__probePoll=setInterval(()=>window.amiba.agentDiagnostics.status().catch(()=>{}),50)");
  cli.kill("SIGINT");
  await wait(() => cli.exitCode !== null);
  await wait(async () => { try { return await evaluate("Boolean(document.querySelector('[data-amiba-product-shell]')) && !document.querySelector('#amiba-plugin-probe')"); } catch { return false; } });
  assert.equal(await readFile(installedManifest, "utf8"), before);
  console.log(`${author ? "Author" : "Installed"}${native ? " + native" : ""} Desktop file: plugin development passed: CLI attach, host/client rebuild, client HMR without document reload, detach, installed profile unchanged.`);
} finally {
  if (cli?.exitCode === null) cli.kill("SIGTERM");
  if (process.exitCode) console.error(cliLogs);
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
