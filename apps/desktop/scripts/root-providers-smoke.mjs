import assert from 'node:assert/strict';

export async function smokeRootProviders({ evaluate, wait }) {
  await evaluate(`(async () => {
    const ctx=window.__probeCtx;
    const h=window.__probeCreateElement;
    window.__rootProviderSources=[];
    window.__makeRootSource=value=>{
      const listeners=new Set();
      const source={getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:next=>{value=next;for(const fn of [...listeners])fn()},count:()=>listeners.size};
      window.__rootProviderSources.push(source);return source;
    };
    window.__rootPanel=window.__makeRootSource('conversation');
    window.__rootItem=window.__makeRootSource('item-a');
    window.__rootNativeInput=document.querySelector('[contenteditable=true]');
    window.__rootProviderFiber=await ctx.inject(['slots'],child=>{
      child.slots.provideRoot({hooks:{compatPanel:window.__rootPanel},keyedHooks:{compatItem:()=>window.__rootItem}});
    });
    function Value({usePanel,useItem}) {
      return h('output',{'data-root-provider-value':true},usePanel(x=>x)+':'+useItem('a',x=>x));
    }
    window.__rootConsumerOff=ctx.slots.register({name:'sidebar.footer.action',id:'root-source-probe'},props=>{
      window.__rootConsumerProps=props;
      return h('div',{'data-root-provider-consumer':true},h('input',{'data-root-provider-draft':true,defaultValue:'draft'}),props.useCompatPanel&&h(Value,{usePanel:props.useCompatPanel,useItem:props.useCompatItem}));
    });
  })()`);
  await wait(() => evaluate("document.querySelector('[data-root-provider-value]')?.textContent==='conversation:item-a'"));
  await evaluate("window.__rootDraft=document.querySelector('[data-root-provider-draft]');window.__rootDraft.value='unsent draft';window.__rootOriginalSessionsHook=window.__rootConsumerProps.useSessions;window.__rootPanel.set('tools');window.__rootItem.set('item-b')");
  await wait(() => evaluate("document.querySelector('[data-root-provider-value]')?.textContent==='tools:item-b'"));
  assert.ok(await evaluate(`(() => {
    try {window.__probeCtx.slots.provideRoot({props:{useCompatPanel:'invalid'}});return false} catch(error) {return error.message.includes('duplicate root standard prop')}
  })()`));
  await evaluate("window.__rootProviderFiber.dispose()");
  await wait(() => evaluate("!document.querySelector('[data-root-provider-value]') && window.__rootPanel.count()===0 && window.__rootItem.count()===0"));
  assert.ok(await evaluate("document.querySelector('[data-root-provider-draft]')===window.__rootDraft && window.__rootDraft.value==='unsent draft'"));
  await evaluate(`(async()=>{
    window.__rootReplacement=window.__makeRootSource('replacement');
    window.__rootProviderFiber=await window.__probeCtx.inject(['slots'],child=>child.slots.provideRoot({hooks:{compatPanel:window.__rootReplacement},keyedHooks:{compatItem:()=>window.__rootItem}}));
  })()`);
  await wait(() => evaluate("document.querySelector('[data-root-provider-value]')?.textContent==='replacement:item-b'"));
  assert.ok(await evaluate("window.__rootOriginalSessionsHook===window.__rootConsumerProps.useSessions && document.querySelector('[data-root-provider-draft]')===window.__rootDraft && document.querySelector('[contenteditable=true]')===window.__rootNativeInput"));
  await evaluate("window.__rootConsumerOff();window.__rootProviderFiber.dispose()");
  await wait(() => evaluate("!document.querySelector('[data-root-provider-consumer]') && window.__rootProviderSources.every(source=>source.count()===0)"));
  console.log('Root providers passed real desktop source updates, duplicate rejection, fiber unload, replacement, subscription cleanup and original input preservation.');
}
