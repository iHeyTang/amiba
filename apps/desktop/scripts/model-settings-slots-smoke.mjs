import assert from 'node:assert/strict';

/** Runs against the built desktop, its real SlotCore and isolated Host settings. */
export async function smokeModelSettingsSlots({ evaluate, wait }) {
  await evaluate("window.__probeCtx.layout.openSettings('models')");
  await wait(() => evaluate("document.querySelectorAll('[data-provider-row]').length>0"));
  await evaluate(`(() => {
    window.__modelOriginal = [...document.querySelectorAll('[data-provider-row]')].map(n => n.cloneNode(true));
    window.__modelOwners = [];
    const ctx = window.__probeCtx;
    window.__modelDisposers = ctx.settingsScope.describe().getSnapshot().view.namespaces.map(({ns}) =>
      ctx.slots.register({name:'settings.models.provider-card',id:'model-probe-'+ns,key:ns}, owner => {
        window.__modelOwners.push(owner);
        if (owner.provider.settingsNs !== ns) throw new Error('Wrong provider namespace dispatch');
        return window.__probeCreateElement('span', {'data-model-card-probe':owner.provider.provider}, 'MODEL_CARD_EXTRA');
      }));
    window.__modelDisposers.push(ctx.slots.register({name:'settings.models.footer',id:'model-footer-probe'}, () =>
      window.__probeCreateElement('div', {'data-model-footer-probe':true}, 'MODEL_FOOTER_EXTRA')));
  })()`);
  await wait(() => evaluate("!!document.querySelector('[data-model-footer-probe]') && !!document.querySelector('[data-model-card-probe]')"));
  assert.ok(await evaluate("window.__modelOriginal.every((n,i)=>n.isEqualNode(document.querySelectorAll('[data-provider-row]')[i]))"), 'extensions must preserve native provider controls');
  const facts = await evaluate(`(() => {
    const namespaces=window.__probeCtx.settingsScope.describe().getSnapshot().view.namespaces;
    return window.__modelOwners.map(owner => {
      const ns=namespaces.find(n=>n.ns===owner.provider.settingsNs);
      const value=owner.provider.settingsPath.reduce((v,k)=>v?.[k],ns?.value);
      return {provider:owner.provider.provider, configured:owner.configured,
        expected:!!ns && (owner.provider.settingsPath.length===0 || value!==undefined),
        keyType:typeof owner.keyConfigured};
    });
  })()`);
  assert.ok(facts.length > 0);
  for (const fact of facts) {
    assert.equal(fact.configured, fact.expected, `${fact.provider}: configuration must reflect real Host namespace`);
    assert.equal(fact.keyType, 'boolean');
  }
  await evaluate(`(() => {
    const extra=document.querySelector('[data-model-card-probe]');
    window.__modelProbeProvider=extra.getAttribute('data-model-card-probe');
    const row=[...document.querySelectorAll('[data-provider-row]')].find(n=>n.getAttribute('data-provider-row')===window.__modelProbeProvider);
    if (!row) throw new Error('Provider row absent');
    row.querySelector('button[aria-label]').click();
  })()`);
  await wait(() => evaluate("!!document.querySelector('[role=dialog] form')?.closest('[role=dialog]').querySelector('[data-model-card-probe]')"));
  await evaluate("window.__modelDialog=document.querySelector('[role=dialog] form').closest('[role=dialog]');void 0");
  assert.equal(await evaluate("window.__modelDialog.querySelector('[data-model-card-probe]').getAttribute('data-model-card-probe')"), await evaluate('window.__modelProbeProvider'));
  assert.ok(await evaluate("!document.querySelector('[role=dialog] form').contains(window.__modelDialog.querySelector('[data-model-card-probe]'))"), 'extension controls must not submit native configuration form');
  await evaluate("window.__modelDisposers.forEach(dispose=>dispose());void 0");
  await wait(() => evaluate("!document.querySelector('[data-model-card-probe]') && !document.querySelector('[data-model-footer-probe]')"));
  assert.ok(await evaluate("!!document.querySelector('[role=dialog] form')"), 'unload must retain open configuration form');
  await evaluate("Array.from(document.querySelector('[role=dialog] form').querySelectorAll('button')).find(n=>/^(Cancel|取消)$/.test(n.textContent.trim())).click();void 0");
  await wait(() => evaluate("!window.__modelDialog.isConnected"));
  assert.ok(await evaluate("window.__modelOriginal.every((n,i)=>n.isEqualNode(document.querySelectorAll('[data-provider-row]')[i]))"), 'unload must preserve native provider controls');
  await evaluate(`(() => {
    const ctx=window.__probeCtx;
    window.__modelFailures=ctx.settingsScope.describe().getSnapshot().view.namespaces.map(({ns}) =>
      ctx.slots.register({name:'settings.models.provider-card',id:'model-failure-'+ns,key:ns}, () => {
        window.__modelCardFailed=true; throw new Error('MODEL_CARD_EXPECTED_FAILURE');
      }));
    window.__modelFailures.push(ctx.slots.register({name:'settings.models.footer',id:'model-footer-failure'}, () => {
      window.__modelFooterFailed=true; throw new Error('MODEL_FOOTER_EXPECTED_FAILURE');
    }));
  })()`);
  await wait(() => evaluate("window.__modelCardFailed && window.__modelFooterFailed && [...document.querySelectorAll('[data-model-provider-extension], [data-model-settings-footer]')].every(n=>n.getBoundingClientRect().height===0)"));
  assert.ok(await evaluate("window.__modelOriginal.every((n,i)=>n.isEqualNode(document.querySelectorAll('[data-provider-row]')[i]))"), 'failed extensions must preserve native controls and leave no empty area');
  await evaluate("window.__modelFailures.forEach(dispose=>dispose());void 0");
  await evaluate("window.__probeCtx.layout.openSettings('plugins')");
  console.log('Model slots passed real Host configuration facts, keyed card dispatch, additive footer, configuration dialog, unload preservation and zero-height error fallback.');
}
