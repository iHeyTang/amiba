import assert from 'node:assert/strict';

export async function smokeSidebarRight({ evaluate, wait, screenshot }) {
  await evaluate(`(async () => {
    const ctx=window.__probeCtx,h=window.__probeCreateElement,React=window.__probeRequire('react');
    window.__sidebarBodyMounts=0;
    window.__sidebarFiber=await ctx.inject(['sidebarRight','sidebarRightTabs'], child=>{
      window.__sidebarService=child.sidebarRight;
      child.effect(()=>child.slots.register({name:'sidebar.right.tab.guide',priority:-100,select:()=>true}, props=>h('output',{'data-sidebar-guide-probe':''},props.useTabInfo().tab.kind)));
      child.effect(()=>child.slots.register({name:'sidebar.right.tab.menu.item',id:'compat-menu-item'}, props=>h('button',{'data-sidebar-menu-probe':'',onClick:()=>{window.__sidebarMenuKind=props.tab.kind;props.dismiss()}},'Probe menu item')));
      child.effect(()=>child.sidebarRightTabs.register({id:'compat/sidebar-page',kind:'compat-page',title:()=> 'Compat page'}));
      child.effect(()=>child.slots.register({name:'sidebar.right.pane.tab',key:'compat/sidebar-page'}, props=>{
        React.useEffect(()=>{window.__sidebarBodyMounts++},[]);
        const info=props.useTabInfo();window.__sidebarInfo=info;
        return h('output',{'data-sidebar-page':''},info.tab.kind+':'+info.tab.visible+':'+info.tab.navigation.revision);
      }));
      child.effect(()=>child.slots.register({name:'sidebar.right.pane.tab.title',key:'compat/sidebar-page'}, props=>{
        const info=props.useTabInfo();return h('span',{'data-sidebar-title':''},'Title '+info.tab.kind);
      }));
    });
  })()`);
  await wait(() => evaluate("document.querySelector('[role=tab][aria-selected]')!==null"));
  await evaluate("window.__sidebarService.openTab('compat-page')");
  await wait(() => evaluate("document.querySelector('[data-sidebar-page]')?.textContent==='compat-page:true:1'"));
  assert.equal(await evaluate("document.querySelector('[data-sidebar-title]')?.textContent"),'Title compat-page');
  assert.ok(await evaluate("document.querySelector('[data-sidebar-right-native]')?.getBoundingClientRect().width>100"));
  assert.ok(await evaluate("getComputedStyle(document.querySelector('[data-dockkit-pane]')).display==='flex'"));
  await wait(() => evaluate("document.querySelector('[data-dockkit-pane]').getBoundingClientRect().height>200 && document.querySelector('[data-sidebar-right-native]').getBoundingClientRect().right<=innerWidth+1"));
  const mounts = await evaluate('window.__sidebarBodyMounts');
  await evaluate("document.querySelector('[data-sidebar-right-mode=fullscreen]').click()");
  await wait(() => evaluate("Math.abs(document.querySelector('[data-sidebar-right-native]').getBoundingClientRect().width-innerWidth)<1"));
  await evaluate("document.querySelector('[data-sidebar-right-mode=push]').click()");
  await wait(() => evaluate("document.querySelector('[data-sidebar-right-native]').getBoundingClientRect().width<innerWidth-100"));
  assert.equal(await evaluate('window.__sidebarBodyMounts'), mounts);
  await screenshot?.();
  await evaluate("window.__sidebarService.openTab('compat-page')");
  await wait(() => evaluate("document.querySelector('[data-sidebar-page]')?.textContent==='compat-page:true:2'"));
  await evaluate("document.querySelector('[data-sidebar-title]').closest('[data-dockkit-tab]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:300}))");
  await wait(() => evaluate("!!document.querySelector('[data-sidebar-menu-probe]')"));
  await evaluate("document.querySelector('[data-sidebar-menu-probe]').click()");
  await wait(() => evaluate("window.__sidebarMenuKind==='compat-page' && !document.querySelector('[data-sidebar-menu-probe]')"));
  await evaluate("window.__sidebarService.openTab('guide')");
  await wait(() => evaluate("document.querySelector('[data-sidebar-guide-probe]')?.textContent==='guide'"));
  await evaluate("window.__sidebarService.openTab('compat-page')");
  await wait(() => evaluate("!!document.querySelector('[data-sidebar-page]')"));
  await evaluate("window.__sidebarService.toggleExpanded()");
  await wait(() => evaluate("!window.__sidebarService.isExpanded() && (!document.querySelector('[data-sidebar-right-native]') || document.querySelector('[data-sidebar-right-native]').hidden)"));
  assert.ok(await evaluate('!window.__sidebarInfo.tab.signal.aborted'));
  await evaluate("window.__sidebarService.toggleExpanded()");
  await wait(() => evaluate("window.__sidebarService.isExpanded() && document.querySelector('[data-sidebar-right-native]') && !document.querySelector('[data-sidebar-right-native]').hidden"));
  await evaluate("window.__sidebarFiber.dispose()");
  await wait(() => evaluate("!document.querySelector('[data-sidebar-page]') && !!document.querySelector('[data-sidebar-right-unavailable]')"));
  await evaluate("window.__sidebarService.toggleExpanded()");
  await wait(() => evaluate("(!document.querySelector('[data-sidebar-right-native]') || document.querySelector('[data-sidebar-right-native]').hidden)"));
  console.log('Sidebar panel passed actual public service, framework session store, body/title hooks, guide chain and menu owner/dismissal, repeated navigation, fullscreen body retention, collapse retention, type unload fallback and native panel restoration.');
}
