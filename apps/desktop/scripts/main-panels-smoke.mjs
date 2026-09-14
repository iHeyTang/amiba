import assert from 'node:assert/strict';

export async function smokeMainPanels({ evaluate, wait }) {
  await evaluate(`(() => {
    const ctx=window.__probeCtx,h=window.__probeCreateElement;
    window.__mainOriginalSession=ctx.sessions.list.getSnapshot().current;
    window.__mainDraftOff=ctx.slots.register({name:'conversation.session.header.corner',id:'main-draft-probe'},props=>{window.__mainDraftOwner=props;return null});
    window.__mainPanelOff=ctx.slots.register({name:'main',key:'compat-panel'},props=>{
      window.__mainPanelOwner=props;
      return h('div',{'data-main-panel-probe':true},'Panel '+props.usePanelInfo(info=>info.activePanelId));
    });
  })()`);
  await wait(() => evaluate("!!window.__mainDraftOwner?.inputActions"));
  await evaluate("window.__mainDraftOwner.inputActions.setDraft('MAIN_PANEL_UNSENT_DRAFT')");
  await wait(() => evaluate("[...document.querySelectorAll('[data-composer-card] [contenteditable=true]')].some(n=>n.textContent==='MAIN_PANEL_UNSENT_DRAFT')"));
  await evaluate("window.__mainOriginalInput=[...document.querySelectorAll('[data-composer-card] [contenteditable=true]')].find(n=>n.textContent==='MAIN_PANEL_UNSENT_DRAFT');window.__mainSignal=window.__probeCtx.layout.beginNavigation();window.__probeCtx.layout.selectPanel('compat-panel')");
  await wait(() => evaluate("document.querySelector('[data-main-panel-probe]')?.textContent==='Panel compat-panel'"));
  assert.ok(await evaluate("window.__mainSignal.aborted && window.__probeCtx.sessions.list.getSnapshot().current===window.__mainOriginalSession && window.__mainPanelOwner.sessionId===undefined && document.querySelector('[data-testid=chats-view]').getAttribute('aria-hidden')==='true' && window.__mainOriginalInput.isConnected"));
  assert.ok(await evaluate(`(() => {
    window.__mainSignal=window.__probeCtx.layout.beginNavigation();
    try {window.__probeCtx.layout.selectPanel('missing-panel');return false} catch(e) {return e.message.includes('not registered')&&!window.__mainSignal.aborted}
  })()`));
  await evaluate("window.__probeCtx.layout.selectPanel(null)");
  await wait(() => evaluate("!document.querySelector('[data-main-panel-probe]') && document.querySelector('[data-testid=chats-view]').getAttribute('aria-hidden')==='false'"));
  assert.ok(await evaluate("window.__mainOriginalInput.isConnected && window.__mainOriginalInput.textContent==='MAIN_PANEL_UNSENT_DRAFT' && window.__probeCtx.sessions.list.getSnapshot().current===window.__mainOriginalSession"));
  await evaluate("window.__probeCtx.layout.selectPanel('compat-panel')");
  await wait(() => evaluate("!!document.querySelector('[data-main-panel-probe]')"));
  await evaluate("window.__probeCtx.layout.selectPanel('conversation')");
  await wait(() => evaluate("!document.querySelector('[data-main-panel-probe]') && document.querySelector('[data-testid=chats-view]').getAttribute('aria-hidden')==='false'"));
  assert.ok(await evaluate("window.__mainOriginalInput.isConnected && window.__mainOriginalInput.textContent==='MAIN_PANEL_UNSENT_DRAFT' && window.__probeCtx.sessions.list.getSnapshot().current===window.__mainOriginalSession"));
  await evaluate("window.__reservedMainRenders=0;window.__reservedMainOff=window.__probeCtx.slots.register({name:'main',key:'conversation'},()=>{window.__reservedMainRenders++;return window.__probeCreateElement('article',{'data-reserved-main-override':''},'Unexpected replacement')});window.__probeCtx.layout.selectPanel('compat-panel')");
  await wait(() => evaluate("!!document.querySelector('[data-main-panel-probe]')"));
  await evaluate("window.__probeCtx.layout.selectPanel('conversation')");
  await wait(() => evaluate("document.querySelector('[data-testid=chats-view]').getAttribute('aria-hidden')==='false'"));
  assert.ok(await evaluate("window.__reservedMainRenders===0 && !document.querySelector('[data-reserved-main-override]') && window.__mainOriginalInput.isConnected && window.__mainOriginalInput.textContent==='MAIN_PANEL_UNSENT_DRAFT'"),'Reserved main key must preserve the native conversation even with a same-key contribution');
  await evaluate("window.__reservedMainOff();window.__probeCtx.layout.selectPanel('compat-panel')");
  await wait(() => evaluate("!!document.querySelector('[data-main-panel-probe]')"));
  await evaluate("window.__mainPanelOff()");
  await wait(() => evaluate("!document.querySelector('[data-main-panel-probe]') && document.querySelector('[data-testid=chats-view]').getAttribute('aria-hidden')==='false'"));
  assert.ok(await evaluate("window.__mainOriginalInput.isConnected && window.__mainOriginalInput.textContent==='MAIN_PANEL_UNSENT_DRAFT' && window.__probeCtx.sessions.list.getSnapshot().current===window.__mainOriginalSession"));
  await evaluate("window.__mainDraftOwner.inputActions.setDraft('');window.__mainDraftOff()");
  console.log('Main panels passed actual keyed dispatch, public panelInfo, invalid selection rejection, navigation cancellation, unload return and original session/input/draft preservation.');
}
