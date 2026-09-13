import assert from 'node:assert/strict';

export async function smokeMainPanelList({ evaluate, wait, call, screenshot }) {
  await evaluate(`(() => {
    const ctx=window.__probeCtx,h=window.__probeCreateElement;
    window.__panelListSession=ctx.sessions.list.getSnapshot().current;
    window.__panelListNative=[...document.querySelectorAll('[data-testid=main-sidebar] button')];
    window.__panelListOff=[];
    for(const [id,order,label] of [['panel-beta',2,'Beta panel'],['panel-alpha',-1,'Alpha panel']]) {
      window.__panelListOff.push(ctx.slots.register({name:'sidebar.panellist',id,order,label},owner=>
        h('svg',{'data-panel-icon':id,'data-active':String(owner.active),width:owner.size,height:owner.size,viewBox:'0 0 16 16'},h('circle',{cx:8,cy:8,r:5,fill:'currentColor'}))));
    }
    window.__panelBetaOff=ctx.slots.register({name:'main',key:'panel-beta'},()=>h('div',{'data-panel-list-content':'beta'},'Beta panel content'));
    window.__panelListOff.push(window.__panelBetaOff);
  })()`);
  await wait(() => evaluate("document.querySelectorAll('[data-main-panel-navigation]').length===2"));
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-main-panel-navigation]')].map(n=>n.dataset.mainPanelNavigation)"), ['panel-alpha','panel-beta']);
  assert.ok(await evaluate("document.querySelector('[data-main-panel-navigation=panel-alpha]').disabled && !document.querySelector('[data-main-panel-navigation=panel-beta]').disabled"));
  await evaluate("document.querySelector('[data-main-panel-navigation=panel-beta]').focus()");
  assert.ok(await evaluate("document.activeElement===document.querySelector('[data-main-panel-navigation=panel-beta]')"), 'keyboard target must hold DOM focus');
  for (const type of ['keyDown','keyUp']) await call('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:type==='keyDown'?'\r':undefined,unmodifiedText:type==='keyDown'?'\r':undefined});
  await wait(() => evaluate("!!document.querySelector('[data-panel-list-content=beta]')"));
  assert.ok(await evaluate("document.querySelector('[data-main-panel-navigation=panel-beta]').getAttribute('aria-current')==='page' && document.querySelector('[data-panel-icon=panel-beta]').getAttribute('data-active')==='true' && document.querySelector('[data-panel-icon=panel-beta]').getAttribute('width')==='16' && window.__probeCtx.sessions.list.getSnapshot().current===window.__panelListSession"));
  await screenshot();
  await evaluate("window.__panelAlphaOff=window.__probeCtx.slots.register({name:'main',key:'panel-alpha'},()=>window.__probeCreateElement('div',{'data-panel-list-content':'alpha'},'Alpha panel content'))");
  await wait(() => evaluate("!document.querySelector('[data-main-panel-navigation=panel-alpha]').disabled"));
  await evaluate("document.querySelector('[data-main-panel-navigation=panel-alpha]').click()");
  await wait(() => evaluate("!!document.querySelector('[data-panel-list-content=alpha]')"));
  assert.ok(await evaluate("document.querySelector('[data-panel-icon=panel-beta]').getAttribute('data-active')==='false' && document.querySelector('[data-panel-icon=panel-alpha]').getAttribute('data-active')==='true'"));
  await evaluate("window.__panelAlphaOff()");
  await wait(() => evaluate("!document.querySelector('[data-panel-list-content]') && document.querySelector('[data-main-panel-navigation=panel-alpha]').disabled && document.querySelector('[data-testid=chats-view]').getAttribute('aria-hidden')==='false'"));
  await evaluate("window.__panelListOff.forEach(off=>off())");
  await wait(() => evaluate("!document.querySelector('[data-main-panel-navigation]')"));
  assert.ok(await evaluate("window.__panelListNative.every(n=>n.isConnected) && window.__probeCtx.sessions.list.getSnapshot().current===window.__panelListSession"));
  console.log('Panel list passed real entry ordering, delayed main availability, keyboard and pointer selection, icon owner size/active, selected-panel unload and original sidebar/session preservation.');
}
