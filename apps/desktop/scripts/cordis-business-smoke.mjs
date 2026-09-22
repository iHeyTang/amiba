import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

/** Exercise official approval and package views through the real desktop runtime. */
export async function smokeCordisBusiness({ profile, evaluate, wait, call }) {
  const definition = JSON.parse(await readFile(path.join(profile, "cordis-definition.json"), "utf8"));
  assert.equal(definition.sessionId, await evaluate("window.__compatSessionId"));
  assert.equal(definition.hasHostHalf, true);
  await evaluate(`window.__cordisDefinition=${JSON.stringify(definition)};void 0`);
  assert.ok(await evaluate("!!window.__probeCtx.get('dynamicCordisRunner')"));
  // Model-origin activation must surface an automatic approval panel even
  // while the conversation's execution details are collapsed.
  for (const decision of ["decline", "approve"]) {
    const requestFile = path.join(profile, `cordis-request-${decision}`);
    await writeFile(requestFile, "request");
    const requested = await wait(async () => {
      try { return JSON.parse(await readFile(`${requestFile}.json`, "utf8")); } catch { return undefined; }
    });
    assert.equal(requested.status, "awaiting-approval", JSON.stringify(requested));
    await wait(() => evaluate("!!document.querySelector('[data-cordis-panel] [data-cordis-approve]')"));
    assert.equal(await evaluate("window.__probeCtx.get('dynamicCordisRunner').isLoaded(window.__cordisDefinition.pluginId)"), false);
    if (decision === "approve") {
      await writeFile(path.join(profile, "cordis-card.json"), JSON.stringify({pluginRunId:requested.pluginRunId}));
      await wait(() => evaluate("Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Run the compatibility plugin')"));
      await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Run the compatibility plugin').click();void 0");
      await wait(() => evaluate("(()=>{for(const button of document.querySelectorAll('[data-execution-summary] > button[aria-expanded=false]'))button.click();return !!document.querySelector('[data-tool=cordis_run][data-cordis-status=awaiting-approval]')})()"));
      await writeFile(path.join(tmpdir(), "amiba-cordis-approval.png"), Buffer.from((await call("Page.captureScreenshot", {format:"png"})).data, "base64"));
    }
    await evaluate(`document.querySelector('[data-cordis-${decision}]').click();void 0`);
    await wait(() => evaluate("!document.querySelector('[data-cordis-approve]')"));
    if (decision === "decline") {
      assert.equal(await evaluate("window.__probeCtx.get('dynamicCordisRunner').isLoaded(window.__cordisDefinition.pluginId)"), false);

    }
  }
  console.log("Official Cordis approval auto-opened; decline kept code unloaded and approve activated the exact requested package.");
  const loaded = await wait(() => evaluate("window.__probeCtx.get('dynamicCordisRunner').getSnapshot().find(row=>row.pluginId===window.__cordisDefinition.pluginId)"));
  await writeFile(path.join(profile, "cordis-card.json"), JSON.stringify({pluginRunId:loaded.pluginRunId}));
  await wait(() => evaluate("(()=>{document.querySelectorAll('[data-execution-summary] > button[aria-expanded=false]').forEach(n=>n.click());return !!document.querySelector('[data-compat-dynamic]')})()"));
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
