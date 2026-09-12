import { cordisBusinessFixture } from "./cordis-business-fixture.mjs";
import { continuableChildFixture } from './continuable-child-fixture.mjs';
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
  if (socket?.readyState === 1) logs += JSON.stringify(await evaluate("(async()=>({body:document.body.innerText.slice(-8000),hmr:Array.from(window.__probeCtx?.loader.entries()??[]).filter(e=>e.options.name.includes('hmr')||e.options.name.includes('probe')).map(e=>({name:e.options.name,state:e.fiber?.state,inject:e.fiber?.inject})),frames:window.__probeFrames?.map(s=>{try{const f=JSON.parse(s);return {type:f.type,id:f.id,rev:f.rev}}catch{return s}}),diagnostics:(await window.amiba.agentDiagnostics.logs({limit:100})).entries.filter(e=>/PROBE|DOWNLOAD|hmr|error/i.test(e.message))}))()").catch(String));
  logs += "\nNative events: " + await readFile(path.join(profile,"native-events.jsonl"),"utf8").catch(String);
  throw new Error("App UI timeout: " + logs.slice(-18000) + "\nCLI: " + cliLogs);
}
async function call(method, params = {}) {
  if (method === "Page.captureScreenshot" && process.argv.includes("--compat")) {
    await evaluate("(async()=>window.amiba.nativeExtensions.call(await window.amiba.nativeExtensions.connect('dsh-plugin-probe'),'show-main'))()");
  }
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
  await writeFile(path.join(project, "vite.config.mjs"), `export default { build: { emptyOutDir:false, lib: {entry:'src/client.ts',formats:['cjs'],fileName:()=> 'client.js'}, rollupOptions: {external:["react"],output: {banner:'window.__ModuleLoader__.load({id:"dsh-plugin-probe",factory:(require)=>{const module={exports:{}};const exports=module.exports;',footer:'return module.exports;}});'}}}}`);
  const hostSource = version => `export function apply(ctx: any) { ctx.effect(() => { console.log('AMIBA_PROBE_HOST_${version}'); return () => console.log('AMIBA_PROBE_DISPOSE_${version}'); }); }`;
  const clientSource = version => `import {createElement} from "react";${process.argv.includes("--compat") ? "export const inject = [\"slots\", \"settingsScope\", \"layout\", \"sessions\", \"sessionLogDownload\", \"inputTriggers\", \"composerInputs\", \"composerImages\", \"remote\", \"remote.dynamicCordisRunner\"];" : ""}export function apply(ctx: any) { (window as any).__probeCreateElement=createElement; (window as any).__probeCtx=ctx; ctx.effect(() => { const node=document.createElement('div');node.id='amiba-plugin-probe';node.textContent='client-${version}';document.body.append(node);return ()=>node.remove(); }); }`;
  const nativeEvents = path.join(profile, "native-events.jsonl");
  const canonicalProfile = await realpath(profile);
  const nativeSource = version => `import {appendFileSync} from 'node:fs';${process.argv.includes("--compat") ? "import {session,dialog,shell,BrowserWindow} from 'electron';" : ""}export function create(){appendFileSync(${JSON.stringify(nativeEvents)},'native-start-${version}\\n');${process.argv.includes("--compat") ? `const originalOpenPath=shell.openPath;shell.openPath=async(target)=>{if(${JSON.stringify([profile, canonicalProfile])}.includes(target)){appendFileSync(${JSON.stringify(nativeEvents)},'turn-open-directory '+target+'\\n');return '';}return originalOpenPath(target);};const originalPicker=dialog.showOpenDialog;dialog.showOpenDialog=async(...args)=>{const options=args.at(-1);if(!options?.properties?.includes('openDirectory'))return originalPicker.apply(dialog,args);appendFileSync(${JSON.stringify(nativeEvents)},'picker-options '+JSON.stringify({defaultPath:options.defaultPath,properties:options.properties})+'\\n');return {canceled:false,filePaths:[${JSON.stringify(path.join(profile,'native-picked'))}]};};const save=(_event,item)=>{item.setSavePath(${JSON.stringify(path.join(profile,"downloads"))}+'/'+item.getFilename());item.on('done',(_event,state)=>appendFileSync(${JSON.stringify(nativeEvents)},'download-'+state+' '+item.getReceivedBytes()+'/'+item.getTotalBytes()+' '+item.getSavePath()+'\\n'));};session.defaultSession.on('will-download',save);` : ""}return {call(){return 'native-${version}'},rendererCall(_owner,method){${process.argv.includes("--compat") ? "if(method==='show-main'){const win=BrowserWindow.getAllWindows().find(w=>/out\\/renderer\\/index.html/.test(w.webContents.getURL()));if(!win)throw new Error('missing test window');win.showInactive();return 'shown';}" : ""}return 'native-${version}'},dispose(){${process.argv.includes("--compat") ? "session.defaultSession.removeListener('will-download',save);dialog.showOpenDialog=originalPicker;shell.openPath=originalOpenPath;" : ""}appendFileSync(${JSON.stringify(nativeEvents)},'native-stop-${version}\\n')}}}`;

  if (native) {
    await writeFile(path.join(project, "src/native.ts"), nativeSource(1));
    await writeFile(path.join(project, "vite.native.config.mjs"), `export default {build:{emptyOutDir:false,lib:{entry:'src/native.ts',formats:['cjs'],fileName:()=> 'native.cjs'},rollupOptions:{external:['node:fs','electron']}}}`);
  }
  // Write only to this smoke's temporary session, through the real Host log.
  const fixtureCwd = await realpath(profile);
  const turnFixture = process.argv.includes("--compat") ? `let fixtureSession:any;ctx.on('session/created',(s:any)=>{if(s.header.origin==='subagent'||!${JSON.stringify([profile, fixtureCwd])}.includes(s.header.cwd)||s.events.some((e:any)=>e.type==='turn/start'&&e.data.turn===7))return;fixtureSession=s;s.append('turn/start',{turn:7});s.append('user/message',{id:'compat-user',role:'user',source:{kind:'user'},content:[{type:'text',text:'COMPAT_TURN_INPUT'}]},{surfaceOp:'append'});s.append('step/start',{turn:7,step:1});s.append('assistant/message',{turn:7,step:1,message:{id:'compat-assistant',role:'assistant',source:{kind:'model',provider:'compat',model:'fixture'},content:[{type:'text',text:'COMPAT_TURN_REPLY'}]}},{surfaceOp:'append'});s.append('step/end',{turn:7,step:1});s.append('turn/end',{turn:7,reason:{kind:'completed'}});if(${JSON.stringify(process.argv.includes('--command-rows'))})s.append('command/run',{commandId:'compat-row-command',name:'compat-row',args:'  原始😀'});console.log('AMIBA_PROBE_TURN '+s.id);});ctx.effect(()=>{const watcher=watch(${JSON.stringify(profile)},()=>{const s=fixtureSession;if(!s)return;if(existsSync(${JSON.stringify(path.join(profile,'command-row-done'))})&&!s.events.some((e:any)=>e.type==='command/done'&&e.data.commandId==='compat-row-command'))s.append('command/done',{commandId:'compat-row-command',kind:'success',text:'COMPAT_COMMAND_RESULT'});if(existsSync(${JSON.stringify(path.join(profile,'child-create'))})&&!ctx.sessions.get('compat-child')){const child=ctx.sessions.create('compat-child',{meta:{cwd:s.header.cwd,parentSession:s.id,origin:'subagent',delegationDepth:1}});child.append('turn/start',{turn:1});child.append('subagent/descriptor',{version:2,mode:'one-shot',provider:'compat',label:'Compatibility child'});child.append('user/message',{id:'compat-child-user',role:'user',source:{kind:'user'},content:[{type:'text',text:'COMPAT_CHILD_INPUT'}]},{surfaceOp:'append'});child.append('step/start',{turn:1,step:1});child.append('assistant/message',{turn:1,step:1,message:{id:'compat-child-assistant',role:'assistant',source:{kind:'model',provider:'compat',model:'fixture'},content:[{type:'text',text:'COMPAT_CHILD_REPLY'}]}},{surfaceOp:'append'});child.append('step/end',{turn:1,step:1});child.append('turn/end',{turn:1,reason:{kind:'completed'}});console.log('AMIBA_PROBE_CHILD '+child.id);}if(existsSync(${JSON.stringify(path.join(profile,'turn-tail-open'))})&&!s.events.some((e:any)=>e.type==='turn/start'&&e.data.turn===8)){s.append('turn/start',{turn:8});s.append('user/message',{id:'compat-empty-user',role:'user',source:{kind:'plugin',plugin:'compat-test',form:'relay'},content:[{type:'text',text:'COMPAT_EMPTY_TURN_INPUT'}]},{surfaceOp:'append'});}if(existsSync(${JSON.stringify(path.join(profile,'turn-tail-close'))})&&!s.events.some((e:any)=>e.type==='turn/end'&&e.data.turn===8)){s.append('turn/end',{turn:8,reason:{kind:'blocked'}});}if(existsSync(${JSON.stringify(path.join(profile,'turn-tail-deliverables'))})&&!s.events.some((e:any)=>e.type==='turn/start'&&e.data.turn===9)){s.append('turn/start',{turn:9});s.append('user/message',{id:'compat-produced-user',role:'user',source:{kind:'plugin',plugin:'compat-test',form:'relay'},content:[{type:'text',text:'COMPAT_PRODUCED_INPUT'}]},{surfaceOp:'append'});s.append('step/start',{turn:9,step:1});for(let i=0;i<7;i++){const filePath=${JSON.stringify(path.join(profile,'compat-produced'))}+(i===0?'':String(i+1))+'.txt';const callId='compat-write-call-'+i;s.append('tool/call',{turn:9,step:1,callId,name:'write',arguments:JSON.stringify({file_path:filePath,content:'COMPAT_PRODUCED_FILE_CONTENT'})});s.append('tool/result',{turn:9,step:1,message:{id:'compat-write-result-'+i,role:'user',source:{kind:'tool',callId},content:[{type:'tool-result',toolCallId:callId,content:[{type:'text',text:'Written'}]}]}},{surfaceOp:'append'});}s.append('step/end',{turn:9,step:1});s.append('step/start',{turn:9,step:2});const mention=String.fromCharCode(96)+'compat-produced.txt'+String.fromCharCode(96);const prefix='COMPAT_PRODUCED_PREFIX '+mention;const suffix='COMPAT_PRODUCED_REPLY <think>COMPAT_PRIVATE_THOUGHT</think> '+mention;s.append('assistant/chunk',{turn:9,step:2,chunk:{type:'text-delta',index:0,text:prefix}});s.append('assistant/chunk',{turn:9,step:2,chunk:{type:'reasoning-delta',index:1,text:'COMPAT_SOURCE_THOUGHT'}});s.append('assistant/chunk',{turn:9,step:2,chunk:{type:'text-delta',index:2,text:suffix}});if(!${JSON.stringify(process.argv.includes('--interrupted-prose'))})s.append('assistant/message',{turn:9,step:2,message:{id:'compat-produced-reply',role:'assistant',source:{kind:'model',provider:'compat',model:'fixture'},content:[{type:'text',text:prefix},{type:'reasoning',text:'COMPAT_SOURCE_THOUGHT'},{type:'text',text:suffix}]}},{surfaceOp:'append'});s.append('step/end',{turn:9,step:2});s.append('turn/end',{turn:9,reason:{kind:${JSON.stringify(process.argv.includes('--interrupted-prose') ? 'blocked' : 'completed')}}});}});return()=>watcher.close();});` : "";
  const source = version => native ? `import {watch,existsSync,readFileSync,writeFileSync} from 'node:fs';export const inject=['amibaRuntimeGateway','sessions'${process.argv.includes('--cordis-business') ? ",'dynamicCordisRunner'" : ''}${process.argv.includes('--child-continuation') ? ",'agents','subagents','llm'" : ''}]; export async function apply(ctx:any) { ${process.argv.includes('--child-continuation') ? continuableChildFixture(root, profile) : ''} ${turnFixture} ${process.argv.includes('--cordis-business') ? cordisBusinessFixture(profile,fixtureCwd) : ''} let lease:string|undefined;let disposed=false;ctx.effect(()=>async()=>{disposed=true;if(lease)await ctx.amibaRuntimeGateway.call('amiba_native_detach',{lease})});lease=await ctx.amibaRuntimeGateway.call('amiba_native_attach',{packageName:'dsh-plugin-probe',instanceId:'probe-'+Date.now()});if(disposed){await ctx.amibaRuntimeGateway.call('amiba_native_detach',{lease});return}console.log('AMIBA_PROBE_HOST_${version}'); }` : hostSource(version);
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
    const muxTransport = await evaluate(`(async () => {
      const socket = new WebSocket('ws://dsh.internal/api/events.mux');
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('mux open timeout')), 10000);
          socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, {once:true});
          socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('mux open failed')); }, {once:true});
        });
        return socket.readyState;
      } finally { socket.close(); }
    })()`);
    assert.equal(muxTransport, 1, "child mux must establish over the real Desktop WebSocket bridge");
    console.log("compat child mux WebSocket readiness verified");
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
    assert.ok(await evaluate("window.__probeCtx.get('conversationEvents').entries().some(d=>d.kind==='turn-tail') && window.__probeCtx.get('conversationEvents').entries().some(d=>d.kind==='assistant-step') && window.__probeCtx.get('conversationViews').entries().some(d=>d.target==='chat')"), "headless official data definitions and chat target must be mounted");
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
      }, ({sessionId,injectedSessionId,useSession}) => { window.__compatChatSnapshot=useSession(s=>s.chat); return 'COMPAT_VIEW:' + sessionId + ':' + injectedSessionId; });
    })()`);
    await wait(() => evaluate("Array.from(document.querySelectorAll('[role=tab]')).some(n=>n.textContent==='Compatibility view')"));
    await evaluate("window.__nativeChatNode=document.querySelector('main[role=tabpanel]');Array.from(document.querySelectorAll('[role=tab]')).find(n=>n.textContent==='Compatibility view').click()");
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_VIEW:'+window.__compatSessionId+':'+window.__compatSessionId)"));
    assert.ok(await evaluate("window.__nativeChatNode.isConnected && window.__nativeChatNode.hidden"), "native chat stays mounted while viewing plugin");
    assert.ok(await evaluate("Array.isArray(window.__compatChatSnapshot.timeline.turnOrder) && window.__compatChatSnapshot.timeline.turns instanceof Map && typeof window.__compatChatSnapshot.nodes.values==='function'"), "a real session must expose the headless chat snapshot to plugin views");
    await writeFile(path.join(tmpdir(), "amiba-conversation-plugin-view.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
    await evaluate("window.__compatViewOff();delete window.__compatViewOff");
    await wait(() => evaluate("window.__nativeChatNode.isConnected && !window.__nativeChatNode.hidden && !document.body.textContent.includes('COMPAT_VIEW:') && !Array.from(document.querySelectorAll('[role=tab]')).some(n=>n.textContent==='Compatibility view')"));
    await writeFile(path.join(tmpdir(), "amiba-conversation-native-view.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
    console.log("Conversation view passed: actual session props/injection, selection, preserved native chat and unload fallback.");
    if (process.argv.includes("--cordis-business")) {
      const definition = JSON.parse(await readFile(path.join(profile, "cordis-definition.json"), "utf8"));
      assert.equal(definition.sessionId, await evaluate("window.__compatSessionId"));
      assert.equal(definition.hasHostHalf, true);
      await evaluate(`window.__cordisDefinition=${JSON.stringify(definition)};void 0`);
      assert.ok(await evaluate("!!window.__probeCtx.get('dynamicCordisRunner')"));
      await evaluate("window.__probeCtx.get('dynamicCordisRunner').startUserRun({agentId:window.__compatSessionId,pluginId:window.__cordisDefinition.pluginId,packageId:window.__cordisDefinition.packageId,mode:'run',hasClientHalf:true})");
      const loaded = await wait(() => evaluate("window.__probeCtx.get('dynamicCordisRunner').getSnapshot().find(row=>row.pluginId===window.__cordisDefinition.pluginId)"));
      await writeFile(path.join(profile, "cordis-card.json"), JSON.stringify({pluginRunId:loaded.pluginRunId}));
      await wait(() => evaluate("!!document.querySelector('[data-execution-summary] > button[aria-expanded=false]')"));
      await evaluate("document.querySelector('[data-execution-summary] > button[aria-expanded=false]').click();void 0");
      await wait(() => evaluate("!!document.querySelector('[data-compat-dynamic]')"));
      assert.deepEqual(await evaluate("(()=>{const n=document.querySelector('[data-compat-dynamic]');return {pluginId:n.dataset.plugin,packageId:n.dataset.package,pluginRunId:n.dataset.run}})()"), {pluginId:definition.pluginId,packageId:definition.packageId,pluginRunId:loaded.pluginRunId});
      await evaluate("document.querySelector('[data-compat-dynamic]').click();void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_DYNAMIC 1')"));
      assert.equal(await evaluate("document.querySelector('[data-compat-dynamic]').dataset.hostEcho"), "RPC_中文😀");
      const wrongRun = await evaluate(`window.__probeCtx.remote.dynamicCordisRunner.invoke(${JSON.stringify(definition.pluginId)},${JSON.stringify(loaded.pluginRunId+'-stale')},'increment',{})`);
      assert.equal(wrongRun.ok, true);
      assert.equal(wrongRun.value.code, "stale-run");
      await writeFile(path.join(tmpdir(), "amiba-cordis-business.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
      assert.ok(await evaluate("Array.from(document.querySelectorAll('style[data-dyn]')).some(n=>n.dataset.dyn===window.__cordisDefinition.pluginId)"));
      const stopped = await evaluate("window.__probeCtx.remote.dynamicCordisRunner.stopFromPanel(window.__compatSessionId,window.__cordisDefinition.pluginId)");
      assert.equal(stopped.ok, true);
      await wait(() => evaluate("!document.querySelector('[data-compat-dynamic]')&&!window.__probeCtx.get('dynamicCordisRunner').isLoaded(window.__cordisDefinition.pluginId)"));
      assert.ok(await evaluate("!Array.from(document.querySelectorAll('style[data-dyn]')).some(n=>n.dataset.dyn===window.__cordisDefinition.pluginId)"));
      const afterStop = await evaluate(`window.__probeCtx.remote.dynamicCordisRunner.invoke(${JSON.stringify(definition.pluginId)},${JSON.stringify(loaded.pluginRunId)},'increment',{})`);
      assert.equal(afterStop.ok, true);
      assert.equal(afterStop.value.code, "plugin-not-running");
      await evaluate("window.__probeCtx.get('dynamicCordisRunner').startUserRun({agentId:window.__compatSessionId,pluginId:window.__cordisDefinition.pluginId,packageId:window.__cordisDefinition.packageId,mode:'run',hasClientHalf:true})");
      const restarted = await wait(() => evaluate("window.__probeCtx.get('dynamicCordisRunner').getSnapshot().find(row=>row.pluginId===window.__cordisDefinition.pluginId)"));
      assert.notEqual(restarted.pluginRunId, loaded.pluginRunId);
      const oldRun = await evaluate(`window.__probeCtx.remote.dynamicCordisRunner.invoke(${JSON.stringify(definition.pluginId)},${JSON.stringify(loaded.pluginRunId)},'increment',{})`);
      assert.equal(oldRun.value.code, "stale-run");
      const freshRun = await evaluate(`window.__probeCtx.remote.dynamicCordisRunner.invoke(${JSON.stringify(definition.pluginId)},${JSON.stringify(restarted.pluginRunId)},'increment',{text:'fresh'})`);
      assert.deepEqual(freshRun.value, {ok:true,value:{count:1,text:'fresh',origin:'Host'}});
      assert.ok(await evaluate("!document.querySelector('[data-compat-dynamic]')"), "an earlier tool result must not host a new activation");
      await writeFile(path.join(profile, "cordis-update"), "update");
      const nextDefinition = await wait(async () => { try { return JSON.parse(await readFile(path.join(profile, "cordis-next-definition.json"), "utf8")); } catch { return undefined; } });
      assert.equal(nextDefinition.pluginId, definition.pluginId);
      assert.notEqual(nextDefinition.packageId, definition.packageId);
      await evaluate(`window.__probeCtx.get('dynamicCordisRunner').startUserRun({agentId:window.__compatSessionId,pluginId:${JSON.stringify(nextDefinition.pluginId)},packageId:${JSON.stringify(nextDefinition.packageId)},mode:'update',hasClientHalf:true})`);
      const upgraded = await wait(() => evaluate(`window.__probeCtx.get('dynamicCordisRunner').getSnapshot().find(row=>row.packageId===${JSON.stringify(nextDefinition.packageId)})`));
      assert.notEqual(upgraded.pluginRunId, restarted.pluginRunId);
      await writeFile(path.join(profile, "cordis-next-card.json"), JSON.stringify({pluginRunId:upgraded.pluginRunId}));
      await wait(() => evaluate("(()=>{for(const button of document.querySelectorAll('[data-execution-summary] > button[aria-expanded=false]'))button.click();return document.body.textContent.includes('COMPAT_DYNAMIC_V2 0')})()"));
      assert.equal(await evaluate("document.querySelectorAll('[data-compat-dynamic]').length"), 1);
      assert.equal(await evaluate("document.querySelector('[data-compat-dynamic]').dataset.package"), nextDefinition.packageId);
      await evaluate("document.querySelector('[data-compat-dynamic]').click();void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_DYNAMIC_V2 1')"));
      const updatedHost = await evaluate(`window.__probeCtx.remote.dynamicCordisRunner.invoke(${JSON.stringify(definition.pluginId)},${JSON.stringify(upgraded.pluginRunId)},'increment',{text:'updated'})`);
      assert.deepEqual(updatedHost.value, {ok:true,value:{count:2,text:'updated',origin:'Host-v2'}});
      const obsolete = await evaluate(`window.__probeCtx.remote.dynamicCordisRunner.invoke(${JSON.stringify(definition.pluginId)},${JSON.stringify(restarted.pluginRunId)},'increment',{})`);
      assert.equal(obsolete.value.code, "stale-run");
      await evaluate("window.__cordisOriginalEditor=document.querySelector('[data-composer-card] [contenteditable=true]');window.__cordisOriginalGroup=document.querySelector('[data-execution-summary]');document.querySelector('[data-compat-dynamic]').click();void 0");
      await wait(() => evaluate("window.__probeCtx.get('dynamicCordisRunner').renderFailures.getSnapshot().get(window.__cordisDefinition.pluginId)?.message.includes('COMPAT_RENDER_FAILURE')"));
      const renderFailure = await evaluate("window.__probeCtx.get('dynamicCordisRunner').renderFailures.getSnapshot().get(window.__cordisDefinition.pluginId)");
      assert.equal(renderFailure.slot, "tool.view.cordis");
      assert.ok(await evaluate("window.__cordisOriginalEditor.isConnected&&window.__cordisOriginalEditor===document.querySelector('[data-composer-card] [contenteditable=true]')&&window.__cordisOriginalGroup.isConnected"));
      assert.equal(await evaluate("window.__probeCtx.composerInputs.setInputDraft(window.__compatSessionId,'COMPAT_POST_CRASH_DRAFT')"), true);
      await wait(() => evaluate("window.__cordisOriginalEditor.textContent==='COMPAT_POST_CRASH_DRAFT'"));
      await evaluate("window.__probeCtx.composerInputs.setInputDraft(window.__compatSessionId,'');void 0");
      await writeFile(path.join(tmpdir(), "amiba-cordis-render-failure.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
      console.log("Dynamic render failure was contained to its slot; native editor and tool group survived", {abdicated:renderFailure.abdicated});
      await evaluate("window.__probeCtx.remote.dynamicCordisRunner.stopFromPanel(window.__compatSessionId,window.__cordisDefinition.pluginId)");
      await wait(() => evaluate("!window.__probeCtx.get('dynamicCordisRunner').isLoaded(window.__cordisDefinition.pluginId)"));
      assert.ok(await evaluate("!window.__probeCtx.get('dynamicCordisRunner').renderFailures.getSnapshot().has(window.__cordisDefinition.pluginId)"));
      assert.ok(await evaluate("!Array.from(document.querySelectorAll('style[data-dyn]')).some(n=>n.dataset.dyn===window.__cordisDefinition.pluginId)"));
      console.log("Dynamic Cordis Client-to-Host RPC preserved Unicode, rejected stopped/stale runs and isolated Host state after restart and package update; native cards and cleanup remained intact");
    }
    if (process.argv.includes("--command-rows")) {
      await evaluate("window.__commandRowOff=window.__probeCtx.slots.register({name:'conversation.chat.commandview',key:'compat-row',id:'compat-command-row'},props=>{window.__commandRowOwner=props;return window.__probeCreateElement('div',{'data-compat-command-row':''},props.node.outcome?.text??'COMPAT_COMMAND_EXECUTING')});void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_COMMAND_EXECUTING')"));
      assert.deepEqual(await evaluate("({name:window.__commandRowOwner.node.name,args:window.__commandRowOwner.node.args,outcome:window.__commandRowOwner.node.outcome,sessionId:window.__commandRowOwner.sessionId})"), {name:'compat-row',args:'  原始😀',outcome:null,sessionId:await evaluate("window.__compatSessionId")});
      await writeFile(path.join(profile, "command-row-done"), "done");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_COMMAND_RESULT')"));
      assert.ok(await evaluate("(()=>{const chat=window.__probeCtx.sessions.binding(window.__compatSessionId).session.getSnapshot().chat;return chat.order.some(key=>chat.nodes.get(key)?.data===window.__commandRowOwner.node)})()"));
      await writeFile(path.join(tmpdir(), "amiba-command-row.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
      await evaluate("window.__commandRowOff();void 0");
      await wait(() => evaluate("!document.querySelector('[data-compat-command-row]')"));
      const commandSessionId = await evaluate("window.__compatSessionId");
      await call("Page.reload", {});
      await wait(() => evaluate("!!window.__probeCtx?.sessions"));
      await evaluate(`window.__compatSessionId=${JSON.stringify(commandSessionId)};window.__probeCtx.layout.openChat();window.__probeCtx.sessions.open(window.__compatSessionId);void 0`);
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_COMMAND_RESULT')"));
      await evaluate("window.__commandRowOff=window.__probeCtx.slots.register({name:'conversation.chat.commandview',key:'compat-row',id:'compat-command-row'},()=>window.__probeCreateElement('div',{'data-compat-command-row':''},'COMPAT_CUSTOM_RESULT'));void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_CUSTOM_RESULT')&&!document.body.textContent.includes('COMPAT_COMMAND_RESULT')"));
      await evaluate("window.__commandRowOff();void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_COMMAND_RESULT')&&!document.body.textContent.includes('COMPAT_CUSTOM_RESULT')"));
      console.log("Official keyed command row received the actual Host lifecycle and args; renderer reload upgraded one durable result without duplication, and unregister restored its native presentation");
    }
    if (process.argv.includes("--input-state")) {
      await evaluate("window.__inputSource=window.__probeCtx.composerInputs.inputDraftSource(window.__compatSessionId);window.__inputObserved=[];window.__inputOff=window.__inputSource.subscribe(()=>{const s=window.__inputSource.getSnapshot();window.__inputObserved.push(s?{draft:s.draft,phase:s.phase}:null)});window.__initialInput=window.__inputSource.getSnapshot();void 0");
      assert.equal(await evaluate("window.__initialInput.phase"), "plain");
      await evaluate("window.__regionCard=Array.from(document.querySelectorAll('[data-composer-card]')).find(n=>n.getClientRects().length>0);window.__regionEditor=window.__regionCard.querySelector('[contenteditable]');window.__regionBaseline={className:window.__regionCard.className,height:window.__regionCard.getBoundingClientRect().height,width:window.__regionCard.getBoundingClientRect().width};window.__regionNames=['conversation.input.dock','conversation.composer.dock','conversation.input.left','conversation.input.right'];window.__regionOwners={};window.__regionOffs=window.__regionNames.map(name=>window.__probeCtx.slots.register({name,id:'compat-input-region'},props=>{window.__officialInputActions=props.inputActions;window.__regionOwners[name]={sessionId:props.sessionId,draft:props.input.draft,imageIds:props.input.imageIds,queueMatches:props.input.queue===props.session.queue};return window.__probeCreateElement(name.endsWith('.dock')?'div':'span',{'data-compat-input-region':name},({'conversation.input.dock':'Input dock','conversation.composer.dock':'Composer dock','conversation.input.left':'Left extension','conversation.input.right':'Right extension'})[name])}));void 0");
      await wait(() => evaluate("document.querySelectorAll('[data-compat-input-region]').length===4"));
      assert.ok(await evaluate("(()=>{const card=window.__regionCard;const region=name=>document.querySelector('[data-compat-input-region=\"'+name+'\"]');const branch=(el,parent)=>{while(el&&el.parentElement!==parent)el=el.parentElement;return el};const above=region('conversation.input.dock'),below=region('conversation.composer.dock'),left=region('conversation.input.left'),right=region('conversation.input.right');const send=Array.from(card.querySelectorAll('button')).find(n=>n.getAttribute('aria-label')?.startsWith('Send'));return branch(above,card.parentElement)&&branch(below,card.parentElement)&&!card.contains(above)&&!card.contains(below)&&(above.compareDocumentPosition(card)&Node.DOCUMENT_POSITION_FOLLOWING)&&(card.compareDocumentPosition(below)&Node.DOCUMENT_POSITION_FOLLOWING)&&card.contains(left)&&card.contains(right)&&branch(right,send.parentElement)?.nextElementSibling===send&&window.__regionEditor===card.querySelector('[contenteditable]')})()"));
      assert.ok(await evaluate("window.__regionNames.every(name=>window.__regionOwners[name].sessionId===window.__compatSessionId&&window.__regionOwners[name].queueMatches)"));
      await evaluate("window.__attachmentSeatOff=window.__probeCtx.slots.register({name:'conversation.input.attachments',id:'compat-attachment-seat',priority:-100},props=>{window.__attachmentSeatOwner=props;return window.__probeCreateElement('span',{'data-compat-attachment-seat':''},'Attachment extension')});void 0");
      await wait(() => evaluate("!!document.querySelector('[data-composer-card] [data-compat-attachment-seat]')&&!!window.__attachmentSeatOwner"));
      await writeFile(path.join(tmpdir(), "amiba-input-regions.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
      await evaluate("window.__wholeInputSource=window.__probeCtx.composerInputs.inputStateSource(window.__compatSessionId);window.__wholeInputObserved=[];window.__wholeInputOff=window.__wholeInputSource.subscribe(()=>{const s=window.__wholeInputSource.getSnapshot();window.__wholeInputObserved.push(s?{draft:s.draft,phase:s.phase,imageIds:s.imageIds,queue:s.queue}:null)});void 0");
      assert.ok(await evaluate("(()=>{const state=window.__wholeInputSource.getSnapshot();return state!==undefined&&state.draft===window.__initialInput.draft&&state.imageIds.length===0&&state.queue===window.__probeCtx.sessions.binding(window.__compatSessionId).session.getSnapshot().queue&&state===window.__wholeInputSource.getSnapshot()})()"));
      assert.equal(await evaluate("window.__probeCtx.composerInputs.setInputDraft(window.__compatSessionId,'COMPAT_INPUT_读取😀',window.__initialInput.draftRev)"), true);
      await wait(() => evaluate("Array.from(document.querySelectorAll('[data-composer-card] [contenteditable]')).some(n=>n.getClientRects().length>0&&n.textContent==='COMPAT_INPUT_读取😀')"));
      assert.equal(await evaluate("window.__inputSource.getSnapshot().draft"), "COMPAT_INPUT_读取😀");
      assert.equal(await evaluate("window.__wholeInputSource.getSnapshot().draft"), "COMPAT_INPUT_读取😀");
      await wait(() => evaluate("window.__regionNames.every(name=>window.__regionOwners[name].draft==='COMPAT_INPUT_读取😀')"));
      assert.equal(await evaluate("window.__probeCtx.composerInputs.setInputDraft(window.__compatSessionId,'STALE_INPUT',window.__initialInput.draftRev)"), false);
      assert.equal(await evaluate("window.__probeCtx.composerInputs.setInputDraft(window.__compatSessionId,'')"), true);
      await wait(() => evaluate("window.__inputSource.getSnapshot().draft===''") );
      assert.ok(await evaluate("window.__inputObserved.some(s=>s?.draft==='COMPAT_INPUT_读取😀')"));
      console.log("Real editor input snapshot, subscription, public write and stale revision rejection verified");
      // Exercise the public submit binding in the real editor, including a
      // synchronous write before React has committed updated Composer props.
      await evaluate(`window.__inputSubmissions=[];window.__submitClaim={token:'/compat-submit ',submit:async(args)=>{window.__inputSubmissions.push(args);await new Promise(resolve=>{window.__finishInputSubmit=resolve});return {kind:'success',text:'COMPAT_INPUT_SUBMIT_OK'}}};window.__submitSourceOff=window.__probeCtx.inputTriggers.registerSource({name:'compat-submit-source',trigger:'/',order:-100,candidates:async()=>[],onPick:()=>({claim:window.__submitClaim}),matchEnter:async(_session,line)=>line.startsWith('/compat-submit ')?{claim:window.__submitClaim}:undefined});void 0`);
      assert.deepEqual(await evaluate("(()=>{const bridge=window.__probeCtx.composerInputs;return [bridge.setInputDraft(window.__compatSessionId,'/compat-submit initial'),bridge.submitInput(window.__compatSessionId),bridge.submitInput(window.__compatSessionId)]})()"), [true,true,false]);
      await wait(() => evaluate("window.__inputSource.getSnapshot().phase==='claimed'"));
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert.deepEqual(await evaluate("(()=>{const bridge=window.__probeCtx.composerInputs;window.__officialInputActions.setDraft('/compat-submit 最新😀');window.__officialInputActions.submit();return [true,true,bridge.submitInput(window.__compatSessionId)]})()"), [true,true,false]);
      await wait(() => evaluate("window.__inputSubmissions.length===1&&typeof window.__finishInputSubmit==='function'"));
      assert.deepEqual(await evaluate("window.__inputSubmissions"), ["最新😀"]);
      assert.equal(await evaluate("window.__inputSource.getSnapshot().phase"), "submitting");
      await evaluate("window.__officialInputActions.setDraft('NEXT_DRAFT_保留😀');void 0");
      await wait(() => evaluate("window.__inputSource.getSnapshot().draft==='NEXT_DRAFT_保留😀'"));
      await evaluate("window.__finishInputSubmit();void 0");
      await wait(() => evaluate("window.__inputSource.getSnapshot().phase==='plain'&&window.__inputSource.getSnapshot().draft==='NEXT_DRAFT_保留😀'"));
      await evaluate("window.__officialInputActions.setDraft('');void 0");
      await wait(() => evaluate("window.__inputSource.getSnapshot().phase==='plain'&&window.__inputSource.getSnapshot().draft===''") );
      assert.equal(await evaluate("window.__probeCtx.composerInputs.submitInput(window.__compatSessionId)"), false);
      assert.equal(await evaluate("window.__probeCtx.composerInputs.submitInput('compat-unbound-session')"), false);
      await evaluate("window.__submitSourceOff();void 0");
      console.log("Public input submission used the latest real editor draft, rejected duplicates and empty/unbound submissions, and settled through the native command path");
    }
    if (process.argv.includes("--command-images")) {
      await evaluate("window.__draftImageRegistry=window.__probeCtx.get('composerImages');window.__createDraftImages=window.__draftImageRegistry.createDraftImages;window.__registeredImages=[];window.__draftImageRegistry.createDraftImages=function(files){const images=window.__createDraftImages.call(this,files);window.__registeredImages.push(...images);return images};void 0");
      await evaluate("window.__imageInputSource=window.__probeCtx.composerInputs.inputImagesSource(window.__compatSessionId);window.__imageSnapshots=[];window.__imageInputOff=window.__imageInputSource.subscribe(()=>window.__imageSnapshots.push(window.__imageInputSource.getSnapshot()?.map(image=>image.id)??null));void 0");
      assert.deepEqual(await evaluate("window.__imageInputSource.getSnapshot()"), []);
      const imagePath = path.join(profile, "command-image.png");
      const imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1sAAAAASUVORK5CYII=";
      await writeFile(imagePath, Buffer.from(imageData,"base64"));
      await evaluate(`window.__commandImages=[];window.__imageClaim={token:'/compat-image ',images:true,submit:async(args,ctx,images)=>{window.__commandImages.push({args,images});return {kind:'success',text:'COMPAT_IMAGE_COMMAND_OK'}}};window.__imageSourceOff=window.__probeCtx.inputTriggers.registerSource({name:'compat-image-source',trigger:'/',order:-100,candidates:async()=>[],onPick:()=>({claim:window.__imageClaim}),matchEnter:async(_session,line,_signal,envelope)=>{window.__imageEnvelope=envelope;window.__imageAdjudicated=(window.__imageAdjudicated||0)+1;return line.startsWith('/compat-image ')?{claim:window.__imageClaim}:undefined}});void 0`);
      await evaluate("Array.from(document.querySelectorAll('[data-composer-card]')).find(n=>n.getClientRects().length>0).parentElement.querySelector('input[type=file]').id='compat-image-input';void 0");
      const documentNode = await call("DOM.getDocument");
      const fileNode = await call("DOM.querySelector", {nodeId:documentNode.root.nodeId,selector:'#compat-image-input'});
      await call("DOM.setFileInputFiles", {nodeId:fileNode.nodeId,files:[imagePath]});
      await wait(() => evaluate("document.body.textContent.includes('command-image.png')"));
      await evaluate("Array.from(document.querySelectorAll('[data-composer-card] [contenteditable=true]')).find(n=>n.getClientRects().length>0).focus();void 0");
      await call("Input.insertText", {text:"/compat-image describe"});
      await wait(() => evaluate("Array.from(document.querySelectorAll('[data-composer-card] button')).some(n=>n.getClientRects().length>0&&n.getAttribute('aria-label')?.startsWith('Send')&&!n.disabled)"));
      // First submission adjudicates the claim; the second executes it.
      for (let pass=0;pass<2;pass++) {
        await evaluate("Array.from(document.querySelectorAll('[data-composer-card] button')).find(n=>n.getClientRects().length>0&&n.getAttribute('aria-label')?.startsWith('Send')).click();void 0");
        if(pass===0) {
          await wait(() => evaluate("window.__imageAdjudicated>0"));
          await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        }
      }
      await wait(() => evaluate("window.__commandImages.length===1"));
      assert.deepEqual(await evaluate("window.__imageEnvelope"), {images:1});
      assert.deepEqual(await evaluate("window.__registeredImages.map(image=>({kind:image.kind,name:image.file.name,size:image.file.size,preview:image.previewUrl.startsWith('blob:')}))"), [{kind:"image",name:"command-image.png",size:Buffer.from(imageData,"base64").length,preview:true}]);
      assert.equal(await evaluate("(async()=>{const bytes=new Uint8Array(await window.__registeredImages[0].file.arrayBuffer());return btoa(String.fromCharCode(...bytes))})()"), imageData);
      assert.deepEqual(await evaluate("window.__commandImages[0]"), {args:"describe",images:[{mediaType:"image/png",data:imageData,name:"command-image.png"}]});
      await wait(() => evaluate("!document.body.textContent.includes('command-image.png')"));
      assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-composer-card] [contenteditable]')).find(n=>n.getClientRects().length>0).textContent"), "");
      await wait(() => evaluate("window.__draftImageRegistry.draftImages(window.__registeredImages.map(image=>image.id)).length===0"));
      await evaluate(`window.__extensionImage=window.__draftImageRegistry.createDraftImages([new File([Uint8Array.from(atob(${JSON.stringify(imageData)}),c=>c.charCodeAt(0))],'extension-image.png',{type:'image/png'})])[0];void 0`);
      assert.equal(await evaluate("window.__probeCtx.composerInputs.addInputImages(window.__compatSessionId,[window.__extensionImage.id,'missing-draft-id'])"), false);
      assert.equal(await evaluate("window.__draftImageRegistry.draftImages([window.__extensionImage.id]).length"), 1);
      assert.deepEqual(await evaluate("(()=>{const bridge=window.__probeCtx.composerInputs;bridge.setInputDraft(window.__compatSessionId,'/compat-image extension');return [bridge.addInputImages(window.__compatSessionId,[window.__extensionImage.id]),bridge.submitInput(window.__compatSessionId),bridge.inputImagesFor(window.__compatSessionId)[0]?.id===window.__extensionImage.id,bridge.inputStateSource(window.__compatSessionId).getSnapshot()?.imageIds[0]===window.__extensionImage.id]})()"), [true,false,true,true]);
      await wait(() => evaluate("Array.from(document.querySelectorAll('[data-composer-card] button')).some(n=>n.getClientRects().length>0&&n.getAttribute('aria-label')?.startsWith('Send')&&!n.disabled)"));
      assert.equal(await evaluate("window.__probeCtx.composerInputs.inputImagesFor(window.__compatSessionId)[0].id===window.__extensionImage.id"), true);
      if (process.argv.includes("--input-state")) await wait(() => evaluate("window.__regionNames.every(name=>window.__regionOwners[name].imageIds[0]===window.__extensionImage.id)"));
      assert.equal(await evaluate("window.__probeCtx.composerInputs.submitInput(window.__compatSessionId)"), true);
      await wait(() => evaluate("window.__probeCtx.composerInputs.inputDraftFor(window.__compatSessionId).phase==='claimed'"));
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert.equal(await evaluate("window.__probeCtx.composerInputs.submitInput(window.__compatSessionId)"), true);
      await wait(() => evaluate("window.__commandImages.length===2"));
      assert.deepEqual(await evaluate("window.__commandImages[1]"), {args:"extension",images:[{mediaType:"image/png",data:imageData,name:"extension-image.png"}]});
      await wait(() => evaluate("window.__draftImageRegistry.draftImages([window.__extensionImage.id]).length===0&&!document.body.textContent.includes('extension-image.png')"));
      await evaluate("window.__removedImage=window.__draftImageRegistry.createDraftImages([new File([window.__extensionImage.file],'removed-image.png',{type:'image/png'})])[0];window.__probeCtx.composerInputs.addInputImages(window.__compatSessionId,[window.__removedImage.id]);window.__probeCtx.composerInputs.removeInputImage(window.__compatSessionId,window.__removedImage.id);void 0");
      await wait(() => evaluate("window.__draftImageRegistry.draftImages([window.__removedImage.id]).length===0&&!document.body.textContent.includes('removed-image.png')"));
      console.log("Extension-created images entered the native upload and command path with original bytes and identity; missing IDs were rejected atomically and immediate removal released the draft");
      await wait(() => evaluate("window.__probeCtx.composerInputs.addInputImages(window.__compatSessionId,[])"));
      assert.deepEqual(await evaluate("(()=>{const registry=window.__draftImageRegistry;const bridge=window.__probeCtx.composerInputs;window.__pruneImages=registry.createDraftImages([window.__extensionImage.file,window.__extensionImage.file]);const added=bridge.addInputImages(window.__compatSessionId,window.__pruneImages.map(image=>image.id));bridge.pruneInputImages(window.__compatSessionId,[window.__pruneImages[1].id]);const remaining=window.__imageInputSource.getSnapshot();return [added,remaining.length,remaining[0]?.id===window.__pruneImages[1].id,remaining===window.__imageInputSource.getSnapshot()]})()"), [true,1,true,true]);
      await evaluate("window.__probeCtx.composerInputs.pruneInputImages(window.__compatSessionId,[]);void 0");
      await wait(() => evaluate("window.__draftImageRegistry.draftImages(window.__pruneImages.map(image=>image.id)).length===0"));
      await wait(() => evaluate("window.__probeCtx.composerInputs.addInputImages(window.__compatSessionId,[])"));
      assert.deepEqual(await evaluate("window.__imageInputSource.getSnapshot()"), []);
      assert.ok(await evaluate("window.__imageSnapshots.some(ids=>ids?.length===1&&ids[0]===window.__pruneImages[1].id)"));
      assert.ok(await evaluate("window.__imageSnapshots.every(ids=>Array.isArray(ids))"), "attachment updates must not temporarily detach the bound image source");
      await evaluate("window.__imageInputOff();void 0");
      console.log("Real image subscriptions reported synchronous additions and pruning with stable snapshots and no transient detached state");
      await evaluate("window.__draftImageRegistry.createDraftImages=window.__createDraftImages;void 0");
      console.log("Native image upload registered the original browser File and released its compatible draft registry entry after successful submission");
      await evaluate("window.__imageSourceOff();void 0");
      if (process.argv.includes("--input-state")) {
        await wait(() => evaluate("window.__attachmentSeatOwner.canAcceptDrop"));
        await evaluate("window.__attachmentSeatOwner.onAddImages([window.__extensionImage.file]);void 0");
        await wait(() => evaluate("window.__attachmentSeatOwner.attachments.length===1&&window.__attachmentSeatOwner.canAcceptDrop"));
        assert.ok(await evaluate("window.__attachmentSeatOwner.attachments[0].file===window.__extensionImage.file&&window.__attachmentSeatOwner.attachments[0].previewUrl.startsWith('blob:')"));
        await evaluate("window.__attachmentSeatOwner.onRemoveImage(window.__attachmentSeatOwner.attachments[0].id);void 0");
        await wait(() => evaluate("window.__attachmentSeatOwner.attachments.length===0"));
        console.log("Official attachment seat received original browser images and added/removed files through the native upload path");
      }
      console.log("Official image command received original staged bytes through native composer and consumed its draft attachments");
      if(process.argv.includes("--input-state")) {
        assert.deepEqual(await evaluate("Array.from(new Set(window.__inputObserved.filter(Boolean).map(s=>s.phase))).sort()"), ["adjudicating","claimed","plain","submitting"]);
        assert.deepEqual(await evaluate("Array.from(new Set(window.__wholeInputObserved.filter(Boolean).map(s=>s.phase))).sort()"), ["adjudicating","claimed","plain","submitting"]);
        assert.ok(await evaluate("window.__wholeInputObserved.some(s=>s?.imageIds.length===1)"));
        assert.ok(await evaluate("window.__wholeInputSource.getSnapshot().queue===window.__probeCtx.sessions.binding(window.__compatSessionId).session.getSnapshot().queue"));
        await evaluate("window.__wholeInputOff();void 0");
        console.log("Combined input state reported native draft, synchronous image IDs and all four phases with the actual Host inbox projection");
        await evaluate("window.__inputOff();void 0");
        console.log("Real command input published all four official phases through the native input subscription");
      }
    }
    if (process.argv.includes("--input-state")) {
      await evaluate("window.__regionOffs.forEach(off=>off());window.__attachmentSeatOff();void 0");
      await wait(() => evaluate("document.querySelectorAll('[data-compat-input-region]').length===0"));
      assert.ok(await evaluate("(()=>{const card=window.__regionCard;const rect=card.getBoundingClientRect();return card.isConnected&&card.querySelector('[contenteditable]')===window.__regionEditor&&card.className===window.__regionBaseline.className&&Math.abs(rect.height-window.__regionBaseline.height)<1&&Math.abs(rect.width-window.__regionBaseline.width)<1})()"));
      console.log("All four official input regions rendered live native owners in their specified positions; unload preserved the original editor, card styles and dimensions");
      if (process.argv.includes("--command-images")) {
        await evaluate("(()=>{const transfer=new DataTransfer();transfer.items.add(window.__extensionImage.file);window.__regionCard.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))})();void 0");
        await wait(() => evaluate("window.__probeCtx.composerInputs.inputImagesFor(window.__compatSessionId)?.length===1&&window.__probeCtx.composerInputs.addInputImages(window.__compatSessionId,[])"));
        assert.equal(await evaluate("window.__probeCtx.composerInputs.inputImagesFor(window.__compatSessionId).length"), 1);
        await writeFile(path.join(tmpdir(), "amiba-official-attachment-seat.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
        await evaluate("window.__officialInputActions.removeImage(window.__probeCtx.composerInputs.inputImagesFor(window.__compatSessionId)[0].id);void 0");
        await wait(() => evaluate("window.__probeCtx.composerInputs.inputImagesFor(window.__compatSessionId).length===0"));
        console.log("Default official attachment component and native drop handler staged one image without duplicate upload");
      }

    }
    if (process.argv.includes("--child-continuation")) {
      await mkdir(path.join(profile, "continuable"), { recursive: true });
      await writeFile(path.join(profile, "continuable-create"), "create");
      await wait(async () => (await evaluate("window.amiba.agentDiagnostics.logs({search:'AMIBA_PROBE_CONTINUABLE'})")).entries.some(e=>JSON.stringify(e).includes('AMIBA_PROBE_CONTINUABLE {')));
      await wait(() => evaluate("(async()=>{await window.__probeCtx.sessions.refreshSubagents('compat-continuable-parent');return window.__probeCtx.sessions.list.getSnapshot().subagentsByParent['compat-continuable-parent']?.entries.some(e=>e.kind==='child'&&e.id==='compat-continuable-child')})()"));
      await evaluate("window.__probeCtx.sessions.openSubagent({parentSessionId:'compat-continuable-parent',childSessionId:'compat-continuable-child',mode:'continuable'});void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_CONTINUABLE_REPLY COMPAT_INITIAL_CHILD')"));
      await evaluate("Array.from(document.querySelectorAll('[data-composer-card] [contenteditable=true]')).find(n=>n.getClientRects().length>0).focus();void 0");
      await call("Input.insertText", { text: "COMPAT_NATIVE_FOLLOWUP" });
      await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_CONTINUABLE_REPLY COMPAT_NATIVE_FOLLOWUP')"));
      console.log("Real continuable child execution through native composer verified");
      await wait(() => evaluate("!document.querySelector('[data-composer-card] button[aria-label=\"Stop generation\"]')"));
      await evaluate("Array.from(document.querySelectorAll('[data-composer-card] [contenteditable=true]')).find(n=>n.getClientRects().length>0).focus();void 0");
      await call("Input.insertText", { text: "COMPAT_WAIT_FOR_STOP" });
      await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_CONTINUABLE_REPLY COMPAT_WAIT_FOR_STOP')"));
      await wait(() => evaluate("Boolean(document.querySelector('[data-composer-card] button[aria-label=\"Stop generation\"]'))"));
      await evaluate("document.querySelector('[data-composer-card] button[aria-label=\"Stop generation\"]').click();void 0");
      await wait(async () => (await evaluate("window.amiba.agentDiagnostics.logs({search:'AMIBA_PROBE_CHILD_ABORTED'})")).entries.length > 0);
      await wait(() => evaluate("!document.querySelector('[data-composer-card] button[aria-label=\"Stop generation\"]')"));
      assert.equal(await evaluate("window.__probeCtx.sessions.subagentAddress('compat-continuable-child')?.parentSessionId"), "compat-continuable-parent");
      console.log("Real continuable child interrupt reached the running model and cleared native busy state");
      await evaluate("window.__probeCtx.sessions.open(window.__compatSessionId);void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_TURN_REPLY')"));
    }
    if (process.argv.includes("--child-navigation")) {
      await writeFile(path.join(profile, "child-create"), "create");
      await wait(async () => (await evaluate("window.amiba.agentDiagnostics.logs({search:'AMIBA_PROBE_CHILD'})")).entries.length > 0);
      await evaluate("window.__probeCtx.sessions.refreshSubagents(window.__compatSessionId)");
      console.log("child catalog after creation", await evaluate("window.__probeCtx.sessions.list.getSnapshot().subagentsByParent[window.__compatSessionId]"));
      await wait(() => evaluate("(async()=>{await window.__probeCtx.sessions.refreshSubagents(window.__compatSessionId);return window.__probeCtx.sessions.list.getSnapshot().subagentsByParent[window.__compatSessionId]?.entries.some(e=>e.kind==='child'&&e.id==='compat-child')})()"));
      await evaluate("window.__probeCtx.sessions.openSubagent({parentSessionId:window.__compatSessionId,childSessionId:'compat-child',mode:'one-shot'});void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_CHILD_REPLY') && !document.body.textContent.includes('COMPAT_TURN_REPLY')"));
      assert.equal(await evaluate("window.__probeCtx.sessions.subagentAddress('compat-child').parentSessionId"), await evaluate("window.__compatSessionId"));
      assert.ok(await evaluate("Array.from(document.querySelectorAll('[data-composer-card] [contenteditable]')).some(n=>n.getClientRects().length>0&&n.getAttribute('contenteditable')==='false')"), "one-shot child composer must be read-only");
      await writeFile(path.join(tmpdir(), "amiba-child-readonly.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
      await evaluate("window.__probeCtx.sessions.open(window.__compatSessionId);void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_TURN_REPLY') && !document.body.textContent.includes('COMPAT_CHILD_REPLY')"));
      await evaluate("window.__probeCtx.sessions.open('compat-child');void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_CHILD_REPLY')"));
      await evaluate("window.__probeCtx.sessions.open(window.__compatSessionId);void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_TURN_REPLY')"));
      await evaluate("window.__probeCtx.sessions.clear();void 0");
      await wait(() => evaluate("window.__probeCtx.sessions.list.getSnapshot().current===undefined && !document.body.textContent.includes('COMPAT_TURN_REPLY')"));
      await evaluate("window.__probeCtx.sessions.openSubagent({parentSessionId:window.__compatSessionId,childSessionId:'compat-child',mode:'one-shot'});void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_CHILD_REPLY') && window.__probeCtx.sessions.list.getSnapshot().current==='compat-child'"));
      await evaluate("window.__probeCtx.sessions.open(window.__compatSessionId);void 0");
      await wait(() => evaluate("document.body.textContent.includes('COMPAT_TURN_REPLY')"));
      assert.ok(await evaluate("Array.from(document.querySelectorAll('[data-composer-card] [contenteditable]')).some(n=>n.getClientRects().length>0&&n.getAttribute('contenteditable')==='true')"), "ordinary parent composer must become editable again");
      console.log("Real catalog child navigation, Home-origin open, read-only composer, transcript and parent return verified");
      if (process.argv.includes("--child-reload")) {
        const parentId = await evaluate("window.__compatSessionId");
        await evaluate("window.__probeCtx.sessions.open('compat-child');void 0");
        await wait(() => evaluate("document.body.textContent.includes('COMPAT_CHILD_REPLY')"));
        await evaluate("window.__beforeChildReload=true;void 0");
        await call("Page.reload", {});
        await wait(async () => { try { return await evaluate("Boolean(!window.__beforeChildReload && window.__probeCtx?.sessions && document.querySelector('[data-amiba-product-shell]'))"); } catch { return false; } });
        await evaluate(`window.__compatSessionId=${JSON.stringify(parentId)};window.__probeCtx.layout.openChat();window.__probeCtx.sessions.open('compat-child');void 0`);
        await wait(() => evaluate("document.body.textContent.includes('COMPAT_CHILD_REPLY')"));
        assert.equal(await evaluate("window.__probeCtx.sessions.subagentAddress('compat-child')?.parentSessionId"), parentId);
        assert.ok(await evaluate("Array.from(document.querySelectorAll('[data-composer-card] [contenteditable]')).some(n=>n.getClientRects().length>0&&n.getAttribute('contenteditable')==='false')"));
        await evaluate("window.__probeCtx.sessions.open(window.__compatSessionId);void 0");
        await wait(() => evaluate("document.body.textContent.includes('COMPAT_TURN_REPLY')"));
        console.log("Child transcript, direct-parent address and read-only state survived full renderer reload");
      }
    }

    const beforeClearIds = await evaluate("window.__probeCtx.sessions.list.getSnapshot().ids");
    await evaluate("window.__probeCtx.sessions.clear();void 0");
    await wait(() => evaluate("window.__probeCtx.sessions.list.getSnapshot().current===undefined && !document.body.textContent.includes('COMPAT_TURN_REPLY')"));
    assert.deepEqual(await evaluate("window.__probeCtx.sessions.list.getSnapshot().ids"), beforeClearIds, "clear must retain every session");
    await evaluate("window.__probeCtx.sessions.open(window.__compatSessionId);void 0");
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_TURN_REPLY') && window.__probeCtx.sessions.list.getSnapshot().current===window.__compatSessionId"));
    console.log("Official sessions.clear passed native deselection, retained session inventory and reopening the same transcript.");

    await evaluate(`window.__turnTailOff=window.__probeCtx.slots.register({name:'conversation.chat.turnTail',select:owner=>[7,8].includes(owner.turn.turn)?true:null},(owner)=>{window.__turnTailOwners??={};window.__turnTailOwners[owner.turn.turn]=owner;window.__turnTailOwner=owner;return 'COMPAT_TURN_TAIL:'+owner.turn.turn+':'+owner.seq;});void 0`);
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_TURN_REPLY') && document.body.textContent.includes('COMPAT_TURN_TAIL:7:')"));
    assert.ok(await evaluate("window.__turnTailOwner.turn===window.__probeCtx.sessions.binding(window.__compatSessionId).session.getSnapshot().chat.timeline.turns.get(7)"), "turn-tail receives the exact engine timeline object");
    assert.ok(await evaluate("window.__turnTailOwner.seq===window.__turnTailOwner.turn.data.get('turn-tail').closing.finalNode.seq && typeof window.__turnTailOwner.openFile==='function'"), "tail uses the closing assistant sequence and a file opener");
    // The raw official create API does not establish Amiba's file-workspace binding.
    await evaluate(`window.amiba.workspaces.bind(window.__compatSessionId, ${JSON.stringify(profile)})`);
    const fileWorkspace = await evaluate("window.amiba.workspaces.getCurrent(window.__compatSessionId)");
    assert.ok(fileWorkspace && (await realpath(fileWorkspace)).startsWith(await realpath(profile)), "file fixture must stay inside the temporary workspace");
    const openedFile = path.join(fileWorkspace, "compat-open.txt");
    await writeFile(openedFile, "COMPAT_FILE_OPENED");
    await evaluate(`window.__turnTailOwners[7].openFile(${JSON.stringify(openedFile)});void 0`);
    await wait(() => evaluate("document.querySelector('[data-workspace-file-preview]')?.textContent.includes('COMPAT_FILE_OPENED')"));
    await writeFile(path.join(profile, "turn-tail-open"), "open");
    await wait(() => evaluate("window.__probeCtx.sessions.binding(window.__compatSessionId).session.getSnapshot().chat.timeline.turns.get(8)?.status==='open'"));
    assert.ok(await evaluate("!document.body.textContent.includes('COMPAT_TURN_TAIL:8:')"), "open empty turns must not render a completed tail");
    await writeFile(path.join(profile, "turn-tail-close"), "close");
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_TURN_TAIL:8:')"));
    assert.ok(await evaluate("window.__turnTailOwners[8].seq===window.__turnTailOwners[8].turn.end.seq && window.__turnTailOwners[8].turn.data.get('turn-tail').closing===null"), "empty live turn uses the exact end sequence with no invented assistant");
    await evaluate("window.__turnTailOff();void 0");
    await wait(() => evaluate("!document.body.textContent.includes('COMPAT_TURN_TAIL:') && document.body.textContent.includes('COMPAT_TURN_REPLY')"));
    console.log("Turn-tail passed actual Host history and live empty completion, exact engine turn/sequence, real file opening, and dynamic mount/unmount.");
    for (let i=0;i<7;i++) await writeFile(path.join(profile, `compat-produced${i===0?"":i+1}.txt`), "COMPAT_PRODUCED_FILE_CONTENT");
    await writeFile(path.join(profile, "turn-tail-deliverables"), "produce");
    await wait(() => evaluate("Array.from(document.querySelectorAll('[data-produced-files-row] button')).some(n=>n.textContent==='compat-produced.txt')"));
    assert.ok(await evaluate("window.__probeCtx.sessions.binding(window.__compatSessionId).session.getSnapshot().chat.timeline.turns.get(9).data.get('deliverables').produced.some(p=>p.path.endsWith('/compat-produced.txt'))"), "official deliverables must derive paths from the real Host-projected tool view");
    await wait(() => evaluate("Array.from(document.querySelectorAll('.chat-md-file-link')).some(n=>n.textContent==='compat-produced.txt')"));
    await evaluate("Array.from(document.querySelectorAll('.chat-md-file-link')).find(n=>n.textContent==='compat-produced.txt').click()");
    await wait(() => evaluate("document.querySelector('[data-workspace-file-preview]')?.textContent.includes('COMPAT_PRODUCED_FILE_CONTENT')"));
    await evaluate("window.__proseBubble=Array.from(document.querySelectorAll('.chat-md-file-link')).find(n=>n.textContent==='compat-produced.txt').closest('[data-selection=text]');window.__proseBubble.querySelector('button[aria-expanded=false]').click();void 0");
    await wait(() => evaluate("Array.from(window.__proseBubble.querySelectorAll('.chat-md-file-link')).filter(n=>n.textContent==='compat-produced.txt').length===2"));
    assert.ok(await evaluate("!Array.from(window.__proseBubble.querySelectorAll('.chat-md-file-link')).some(n=>n.textContent.includes('COMPAT_PRIVATE_THOUGHT'))"), "thinking text must not acquire prose attribution");
    if (process.argv.includes("--interrupted-prose")) {
      assert.ok(await evaluate("(()=>{const turn=window.__probeCtx.sessions.binding(window.__compatSessionId).session.getSnapshot().chat.timeline.turns.get(9);const final=turn.data.get('turn-tail').closing.finalNode;return final.interrupted===true && final.messageId===undefined && !Number.isInteger(final.seq);})()"), "interrupted prose must use the actual synthetic final without a message ID");
      console.log("Interrupted prose passed actual synthetic final, folded narration and real file opening without an assistant/message event.");
    }
    console.log("Official prose links passed live source mapping, folded final-message narration, thinking cleanup and file opening.");
    await evaluate(`window.__markdownRegister = label => window.__probeCtx.slots.register({name:'amiba.markdown.extension',id:'compat-markdown',inject:()=>({extension:{id:'compat-markdown',version:'1',remarkPlugins:[function compatTransform(){return tree=>{tree.children.unshift({type:'paragraph',children:[{type:'text',value:label}]});};}]}})},()=>null);window.__markdownOff=window.__markdownRegister('COMPAT_MARKDOWN_FIRST');void 0`);
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_MARKDOWN_FIRST')"));
    await evaluate("window.__markdownOff();window.__markdownOff=window.__markdownRegister('COMPAT_MARKDOWN_SECOND');void 0");
    await wait(() => evaluate("document.body.textContent.includes('COMPAT_MARKDOWN_SECOND') && !document.body.textContent.includes('COMPAT_MARKDOWN_FIRST')"));
    assert.ok(await evaluate("Array.from(document.querySelectorAll('.chat-md-file-link')).some(n=>n.textContent==='compat-produced.txt')"), "surrounding Markdown transforms retain existing prose file ownership");
    await evaluate("window.__markdownOff();void 0");
    await wait(() => evaluate("!document.body.textContent.includes('COMPAT_MARKDOWN_SECOND')"));
    console.log("Markdown extension replacement passed same-name/same-version transforms, preserved file links and unload cleanup.");

    await evaluate("Array.from(document.querySelectorAll('[data-produced-files-row] button')).find(n=>n.textContent==='compat-produced.txt').click()");
    await wait(() => evaluate("document.querySelector('[data-workspace-file-preview]')?.textContent.includes('COMPAT_PRODUCED_FILE_CONTENT')"));
    await writeFile(path.join(tmpdir(), "amiba-official-deliverables.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data,"base64"));
    await wait(() => evaluate("Boolean(document.querySelector('.P4kPIW_showFolder'))"));
    await evaluate("document.querySelector('.P4kPIW_showFolder').click()");
    await wait(async () => (await readFile(nativeEvents, "utf8")).includes("turn-open-directory "));
    const openedDirectory = (await readFile(nativeEvents,"utf8")).split("\n").find(line=>line.startsWith("turn-open-directory ")).slice("turn-open-directory ".length);
    assert.equal(await realpath(openedDirectory), await realpath(profile), "folder action must use the existing validated session-workspace opener");
    console.log("Official produced-files row passed actual tool-view derivation, file contents and validated directory IPC (OS folder opener stubbed).");
    if (process.argv.includes("--reopen-prose")) {
      const reopenedId = await evaluate("window.__compatSessionId");
      await evaluate("window.__beforeProseReload=true;void 0");
      await call("Page.reload", {});
      await wait(async () => { try { return await evaluate("Boolean(!window.__beforeProseReload && window.__probeCtx?.sessions && document.querySelector('[data-amiba-product-shell]'))"); } catch { return false; } });
      await evaluate(`window.__compatSessionId=${JSON.stringify(reopenedId)};window.__probeCtx.layout.openChat();window.__probeCtx.sessions.open(window.__compatSessionId);void 0`);
      await wait(() => evaluate("Array.from(document.querySelectorAll('.chat-md-file-link')).some(n=>n.textContent==='compat-produced.txt')"));
      await evaluate("Array.from(document.querySelectorAll('.chat-md-file-link')).find(n=>n.textContent==='compat-produced.txt').click()");
      await wait(() => evaluate("document.querySelector('[data-workspace-file-preview]')?.textContent.includes('COMPAT_PRODUCED_FILE_CONTENT')"));
      await writeFile(path.join(tmpdir(), "amiba-history-prose.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data,"base64"));
      console.log("Prose file links passed a full renderer reload and durable history reopen with actual file contents.");
    }
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
