import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function smokeSidebarRight({ evaluate, wait, screenshot, fileWorkspace }) {
  const otherWorkspace = path.join(fileWorkspace, '.cache', 'sidebar-session-other');
  await mkdir(otherWorkspace, { recursive: true });
  await evaluate(`(async () => {
    const ctx=window.__probeCtx,h=window.__probeCreateElement,React=window.__probeRequire('react');
    window.__sidebarBodyMounts=0;window.__sidebarTrace=[];
    window.__sidebarFiber=await ctx.inject(['sidebarRight','sidebarRightTabs'], child=>{
      window.__sidebarService=child.sidebarRight;
      child.effect(()=>child.slots.register({name:'amiba.workbench.panel',id:'compat-sidebar-observer'}, props=>{
        const globalPanel=props.usePanelInfo(info=>info.activePanelId);
        const trace=phase=>{window.__sidebarTrace.push({phase,placement:props.placement,active:props.activePanel,session:props.sessionId,workbenchSession:props.workbenchSessionId,globalPanel,expanded:child.sidebarRight.isExpanded()})};
        React.useEffect(()=>{trace('mount');return()=>trace('unmount')},[]);
        React.useEffect(()=>{trace('commit')});
        return null;
      }));
      child.effect(()=>child.slots.register({name:'main',key:'compat-sidebar-global'},()=>h('article',{'data-sidebar-global':''},'Global sidebar probe')));
      child.effect(()=>child.slots.register({name:'sidebar.right.tab.guide',priority:-100,select:()=>true}, props=>h('output',{'data-sidebar-guide-probe':''},props.useTabInfo().tab.kind)));
      child.effect(()=>child.slots.register({name:'sidebar.right.tab.menu.item',id:'compat-menu-item'}, props=>h('button',{'data-sidebar-menu-probe':'',onClick:()=>{window.__sidebarMenuKind=props.tab.kind;props.dismiss()}},'Probe menu item')));
      child.effect(()=>child.sidebarRightTabs.register({id:'compat/sidebar-page',kind:'compat-page',title:()=> 'Compat page'}));
      child.effect(()=>child.slots.register({name:'sidebar.right.pane.tab',key:'compat/sidebar-page'}, props=>{
        React.useEffect(()=>{window.__sidebarBodyMounts++},[]);
        const info=props.useTabInfo();window.__sidebarInfo=info;const [bornSession]=React.useState(props.sessionId);
        return h('output',{'data-sidebar-page':'','data-sidebar-session':props.sessionId,'data-sidebar-born-session':bornSession},info.tab.kind+':'+info.tab.visible+':'+info.tab.navigation.revision);
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
  await evaluate(`(async()=>{
    window.__sidebarSessionA=window.__probeCtx.sessions.list.getSnapshot().current;
    window.__sidebarActionsA=window.__sidebarInfo.tab.actions;
    window.__sidebarSignalA=window.__sidebarInfo.tab.signal;
    window.__sidebarSessionB=await window.__probeCtx.sessions.create({cwd:${JSON.stringify(otherWorkspace)}});
    window.__probeCtx.sessions.open(window.__sidebarSessionB);
  })()`);
  await wait(() => evaluate("window.__probeCtx.sessions.list.getSnapshot().current===window.__sidebarSessionB && window.__sidebarTrace.filter(item=>item.phase==='commit' && item.placement==='tab').at(-1)?.session===window.__sidebarSessionB && window.__sidebarTrace.filter(item=>item.phase==='commit' && item.placement==='tab').at(-1)?.workbenchSession===window.__sidebarSessionB && !window.__sidebarService.isExpanded()"));
  await evaluate("window.__sidebarService.openTab('compat-page')");
  await wait(() => evaluate("document.querySelector('[data-sidebar-page]')?.dataset.sidebarBornSession===window.__sidebarSessionB && document.querySelector('[data-sidebar-page]')?.textContent==='compat-page:true:1'"));
  await evaluate("window.__sidebarSignalB=window.__sidebarInfo.tab.signal;window.__sidebarActionsA.openTab('guide')");
  assert.ok(await evaluate("document.querySelector('[data-sidebar-page]')?.dataset.sidebarSession===window.__sidebarSessionB && window.__sidebarInfo.tab.signal===window.__sidebarSignalB && !window.__sidebarSignalA.aborted"));
  await evaluate("window.__probeCtx.sessions.open(window.__sidebarSessionA)");
  try {
  await wait(() => evaluate("window.__probeCtx.sessions.list.getSnapshot().current===window.__sidebarSessionA && document.querySelector('[data-sidebar-guide-probe]')?.textContent==='guide'"));
  } catch(error) { console.log('SIDEBAR_SESSION_TRACE',await evaluate("JSON.stringify({a:window.__sidebarSessionA,b:window.__sidebarSessionB,current:window.__probeCtx.sessions.list.getSnapshot().current,active:window.__sidebarService.active(),trace:window.__sidebarTrace,body:document.querySelector('[data-sidebar-page]')?.outerHTML})")); throw error; }
  await evaluate("window.__sidebarService.openTab('compat-page')");
  await wait(() => evaluate("document.querySelector('[data-sidebar-page]')?.dataset.sidebarBornSession===window.__sidebarSessionA"));
  assert.ok(await evaluate("window.__sidebarInfo.tab.signal===window.__sidebarSignalA"));
  await evaluate("window.__probeCtx.sessions.open(window.__sidebarSessionB)");
  await wait(() => evaluate("document.querySelector('[data-sidebar-page]')?.dataset.sidebarBornSession===window.__sidebarSessionB && document.querySelector('[data-sidebar-page]')?.textContent==='compat-page:true:1'"));
  assert.ok(await evaluate("window.__sidebarInfo.tab.signal===window.__sidebarSignalB"));
  await evaluate("window.__probeCtx.sessions.open(window.__sidebarSessionA)");
  await wait(() => evaluate("document.querySelector('[data-sidebar-page]')?.dataset.sidebarBornSession===window.__sidebarSessionA"));
  await evaluate("window.__sidebarService.float(window.__sidebarInfo.tab.id,{x:100,y:100,width:400,height:300})");
  await wait(() => evaluate("!!document.querySelector('[data-sidebar-right-float-host] [data-sidebar-page]')"));
  await evaluate("window.__sidebarSavedSignal=window.__sidebarInfo.tab.signal;window.__sidebarSavedId=window.__sidebarInfo.tab.id;window.__probeCtx.layout.selectPanel('compat-sidebar-global')");
  await wait(() => evaluate("!!document.querySelector('[data-sidebar-global]') && !document.querySelector('[data-sidebar-right-float-host]') && !document.querySelector('[data-sidebar-right-native]') && !window.__sidebarService.isExpanded()"));
  assert.ok(await evaluate("window.__sidebarTrace.some(item=>item.phase==='unmount' && item.placement==='tab')"));
  assert.ok(await evaluate("(()=>{try{window.__sidebarService.openTab('compat-page');return false}catch(e){return e.message.includes('no session surface is mounted') && !window.__sidebarSavedSignal.aborted}})()"));
  await evaluate("window.__probeCtx.layout.selectPanel(null)");
  await wait(() => evaluate("window.__sidebarService.isExpanded() && !!document.querySelector('[data-sidebar-right-float-host] [data-sidebar-page]')"));
  assert.ok(await evaluate("window.__sidebarTrace.filter(item=>item.phase==='mount' && item.placement==='tab').length>=2"));
  assert.ok(await evaluate("window.__sidebarInfo.tab.id===window.__sidebarSavedId && window.__sidebarInfo.tab.signal===window.__sidebarSavedSignal"));
  await evaluate("window.__sidebarService.dock(window.__sidebarInfo.panel.id)");
  try {
  await wait(() => evaluate("!document.querySelector('[data-sidebar-right-float-host]') && !!document.querySelector('[data-sidebar-right-native] [data-sidebar-page]')"));
  } catch(error) { console.log('SIDEBAR_TRACE',await evaluate('JSON.stringify(window.__sidebarTrace)')); throw error; }
  await evaluate("document.querySelector('[data-sidebar-right-mode=fullscreen]').click();window.__probeCtx.layout.selectPanel('compat-sidebar-global')");
  await wait(() => evaluate("!!document.querySelector('[data-sidebar-global]') && !document.querySelector('[data-sidebar-right-native]')"));
  await evaluate("window.__probeCtx.layout.selectPanel(null)");
  await wait(() => evaluate("!!document.querySelector('[data-sidebar-right-mode=push]') && Math.abs(document.querySelector('[data-sidebar-right-native]').getBoundingClientRect().width-innerWidth)<1"));
  await evaluate("document.querySelector('[data-sidebar-right-mode=push]').click()");
  await wait(() => evaluate("document.querySelector('[data-sidebar-right-native]').getBoundingClientRect().width<innerWidth-100"));
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
  console.log('Sidebar panel passed actual public service, framework session store, body/title hooks, guide chain and menu owner/dismissal, repeated navigation, fullscreen body retention, session switching/local-state isolation and original-session callbacks, global-page binding/float/fullscreen isolation and restoration, collapse retention, type unload fallback and native panel restoration.');
}
