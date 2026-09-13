import assert from 'node:assert/strict';

export async function smokeResources({ evaluate, wait }) {
  await evaluate(`(async () => {
    const ctx=window.__probeCtx,h=window.__probeCreateElement;
    window.__resourceAddress='dsh-resource://compat-feed/one';
    window.__resourceFeeds=[];
    const provider={protocol:'compat-feed',open(_address,{signal}) {
      const queue=[];let wake;
      const feed={signal,push(value){queue.push({ok:true,value});wake?.();wake=undefined}};
      window.__resourceFeeds.push(feed);
      signal.addEventListener('abort',()=>{wake?.();wake=undefined},{once:true});
      return (async function*(){while(!signal.aborted){if(!queue.length)await new Promise(resolve=>{wake=resolve});if(queue.length)yield queue.shift()}})();
    }};
    window.__resourceFiber=await ctx.inject(['resources'],child=>{
      child.effect(()=>child.resources.register(provider),'compat feed provider');
      window.__resourceRegistry=child.resources;
    });
    window.__resourceSource=window.__resourceRegistry.source(window.__resourceAddress);
    window.__resourcePin=new AbortController();
    window.__resourceRegistry.pin(window.__resourceAddress,window.__resourcePin.signal);
    window.__resourceRegister=id=>ctx.slots.register({name:'sidebar.footer.action',id},props=>{
      const snapshot=props.useResource(window.__resourceAddress);
      return h('output',{'data-resource-probe':id},snapshot.status+':'+(snapshot.value??''));
    });
    window.__resourceOffA=window.__resourceRegister('resource-a');
    window.__resourceOffB=window.__resourceRegister('resource-b');
  })()`);
  await wait(() => evaluate("document.querySelectorAll('[data-resource-probe]').length===2 && window.__resourceFeeds.length===1"));
  await evaluate("window.__resourceFeeds[0].push('first')");
  await wait(() => evaluate("[...document.querySelectorAll('[data-resource-probe]')].every(n=>n.textContent==='live:first')"));
  await evaluate("window.__resourceOffA();window.__resourceOffB()");
  await wait(() => evaluate("!document.querySelector('[data-resource-probe]')"));
  assert.ok(await evaluate("!window.__resourceFeeds[0].signal.aborted && window.__resourceFeeds.length===1"));
  await evaluate("window.__resourceOffA=window.__resourceRegister('resource-a')");
  await wait(() => evaluate("document.querySelector('[data-resource-probe]')?.textContent==='live:first'"));
  assert.equal(await evaluate("window.__resourceFeeds.length"),1);
  await evaluate("window.__resourcePin.abort()");
  assert.ok(await evaluate("!window.__resourceFeeds[0].signal.aborted"));
  await evaluate("window.__resourceOffA()");
  await wait(() => evaluate("window.__resourceFeeds[0].signal.aborted"));
  assert.ok(await evaluate("window.__resourceRegistry.source(window.__resourceAddress)===window.__resourceSource && window.__resourceSource.getSnapshot().value===undefined"));
  await evaluate("window.__resourceOffB=window.__resourceRegister('resource-b')");
  await wait(() => evaluate("window.__resourceFeeds.length===2"));
  await evaluate("window.__resourceFeeds[1].push('reopened')");
  await wait(() => evaluate("document.querySelector('[data-resource-probe]')?.textContent==='live:reopened'"));
  await evaluate("window.__resourceFiber.dispose()");
  await wait(() => evaluate("document.querySelector('[data-resource-probe]')?.textContent==='none:' && window.__resourceFeeds[1].signal.aborted"));
  await evaluate("window.__resourceOffB()");
  await wait(() => evaluate("!document.querySelector('[data-resource-probe]')"));
  await evaluate(`(() => {
    const ctx=window.__probeCtx,h=window.__probeCreateElement,React=window.__probeRequire('react');
    const source=value=>{const listeners=new Set();return {getSnapshot:()=>value,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)},set(next){value=next;for(const fn of listeners)fn()},count:()=>listeners.size}};
    const fixed=source('fixed'),a=source(1),b=source(2);
    window.__entryKeyed={fixed,a,b};
    window.__entryKeyedOff=ctx.slots.register({name:'sidebar.footer.action',id:'entry-keyed-probe',inject:()=>({hooks:{fixed},keyedHooks:{item:key=>({a,b})[key]},note:'business'})},props=>{
      const [key,setKey]=React.useState('a');window.__entryKeyed.setKey=setKey;
      const value=props.useItem(key,snapshot=>snapshot??-1);
      const ordinary=props.useFixed(value=>value);
      return h('output',{'data-entry-keyed':''},[ordinary,value,props.note,String('hooks' in props),String('keyedHooks' in props)].join(':'));
    });
  })()`);
  const entryText = text => evaluate("document.querySelector('[data-entry-keyed]')?.textContent==="+JSON.stringify(text));
  await wait(() => entryText('fixed:1:business:false:false'));
  await evaluate('window.__entryKeyed.a.set(3)');
  await wait(() => entryText('fixed:3:business:false:false'));
  await evaluate("window.__entryKeyed.setKey('b')");
  await wait(() => entryText('fixed:2:business:false:false'));
  await wait(() => evaluate('window.__entryKeyed.a.count()===0 && window.__entryKeyed.b.count()===1'));
  await evaluate("window.__entryKeyed.setKey('missing');window.__entryKeyed.fixed.set('updated')");
  await wait(() => entryText('updated:-1:business:false:false'));
  await wait(() => evaluate('window.__entryKeyed.b.count()===0'));
  await evaluate('window.__entryKeyedOff()');
  await wait(() => evaluate("!document.querySelector('[data-entry-keyed]') && window.__entryKeyed.fixed.count()===0"));
  console.log('Entry inject keyedHooks passed actual renderer binding, ordinary hooks and business props, source updates, key switching, missing keys and unregistration cleanup.');
  console.log('Resources passed real global hook binding, shared stream, retained pin across consumer remount, last-holder abort, stable source reopening and caller fiber provider unload.');
}
