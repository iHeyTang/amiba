import assert from 'node:assert/strict';

/** Actual chain fallback, registry changes and guide-to-page replacement. */
export async function smokeSidebarGuide({ evaluate, wait, screenshot, activateFocused }) {
  await evaluate(`(async()=>{
    window.__guideFiber=await window.__probeCtx.inject(['sidebarRight','sidebarRightTabs'],child=>{
      window.__guideCtx=child;const h=window.__probeCreateElement;
      child.effect(()=>child.sidebarRightTabs.register({id:'compat/guide-a',kind:'compat-guide-a',title:()=> 'Guide A',guide:[
        {order:20,title:()=> 'Guide third',description:()=> 'Third description'},
        {order:0,title:()=> 'Guide first',description:()=> 'First description'},
      ]}));
      child.effect(()=>child.sidebarRightTabs.register({id:'compat/guide-b',kind:'compat-guide-b',title:()=> 'Guide B',guide:[
        {order:10,title:()=> 'Guide second',description:()=> 'Second description'},
      ]}));
      for(const kind of ['a','b'])child.effect(()=>child.slots.register({name:'sidebar.right.pane.tab',key:'compat/guide-'+kind},props=>{
        const info=props.useTabInfo();window.__guidePageInfo=info;
        return h('output',{'data-guide-target':kind},info.tab.kind);
      }));
      child.effect(()=>child.slots.register({name:'sidebar.right.tab.guide',priority:-100,select:()=>null},()=>h('output',{'data-guide-declined':''},'must not appear')));
      child.sidebarRight.openTab('guide');
    });
  })()`);
  try {
    await wait(() => evaluate("document.querySelectorAll('[data-sidebar-right-guide-entry^=compat-guide]').length===3"));
    assert.ok(await evaluate("!document.querySelector('[data-guide-declined]')"));
    const titles = () => evaluate("[...document.querySelectorAll('[data-sidebar-right-guide-entry^=compat-guide]')].map(button=>button.textContent)");
    assert.deepEqual(await titles(),['Guide firstFirst description','Guide secondSecond description','Guide thirdThird description']);
    const originalTheme = await evaluate("document.documentElement.className");
    try {
      const colors = [];
      for (const theme of ['light','dark']) {
        await evaluate(`document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(${JSON.stringify(theme)})`);
        const style = await evaluate("(()=>{const button=document.querySelector('[data-sidebar-right-guide-entry]'),s=getComputedStyle(button),spans=button.querySelectorAll('span'),description=spans[spans.length-1];return {background:s.backgroundColor,border:s.borderColor,borderWidth:parseFloat(s.borderWidth),foreground:s.color,description:getComputedStyle(description).color}})()");
        assert.notEqual(style.background,'rgba(0, 0, 0, 0)',`${theme}: visible capsule surface`);
        assert.ok(style.borderWidth>0 && style.border!=='rgba(0, 0, 0, 0)',`${theme}: visible capsule border`);
        assert.notEqual(style.foreground,style.description,`${theme}: description hierarchy`);
        colors.push(style.background);
        await screenshot?.('guide-'+theme);
      }
      assert.notEqual(colors[0],colors[1],'Guide follows the native light/dark theme');
    } finally { await evaluate(`document.documentElement.className=${JSON.stringify(originalTheme)}`); }

    await evaluate(`(()=>{
      const child=window.__guideCtx,h=window.__probeCreateElement;
      window.__guideReplacementOff=child.slots.register({name:'sidebar.right.tab.guide',priority:-200,select:()=>true},props=>{
        window.__guideReplacementInfo=props.useTabInfo();return h('output',{'data-guide-replacement':''},'Replacement guide');
      });
    })()`);
    await wait(() => evaluate("!!document.querySelector('[data-guide-replacement]') && !document.querySelector('[data-sidebar-right-guide]')"));
    assert.equal(await evaluate("window.__guideReplacementInfo.tab.kind"),'guide');
    await evaluate("window.__guideReplacementOff()");
    await wait(() => evaluate("!!document.querySelector('[data-sidebar-right-guide]') && !document.querySelector('[data-guide-replacement]')"));
    await evaluate(`(()=>{
      const child=window.__guideCtx;
      window.__guideExtraOff=child.sidebarRightTabs.register({id:'compat/guide-extra',kind:'compat-guide-extra',title:()=> 'Extra',guide:[
        {order:30,title:()=> 'Guide fourth',description:()=> 'Fourth description'},
        {order:40,title:()=> 'Guide fifth',description:()=> 'Fifth description'},
      ]});
    })()`);
    await wait(() => evaluate("document.querySelectorAll('[data-sidebar-right-guide-entry^=compat-guide]').length===5"));
    assert.deepEqual(await titles(),['Guide first','Guide second','Guide third','Guide fourth','Guide fifth']);
    await evaluate("window.__guideExtraOff()");
    await wait(async () => (await titles())[0]==='Guide firstFirst description');
    const before = await evaluate("({id:window.__sidebarService.active().id,count:document.querySelectorAll('[data-dockkit-tab]').length})");
    await evaluate("document.querySelector('[data-sidebar-right-guide-entry=compat-guide-b]').focus()");
    assert.equal(await evaluate("document.activeElement?.getAttribute('data-sidebar-right-guide-entry')"),'compat-guide-b');
    await activateFocused();
    await wait(() => evaluate("document.querySelector('[data-guide-target=b]')?.textContent==='compat-guide-b'"));
    assert.ok(await evaluate("window.__guidePageInfo.tab.visible && window.__guidePageInfo.tab.kind==='compat-guide-b'"));
    assert.equal(await evaluate("document.querySelectorAll('[data-dockkit-tab]').length"),before.count,'Picking a guide entry must replace the guide rather than append a tab');
    assert.ok(await evaluate("!document.querySelector('[data-sidebar-right-guide]')"));
    // Both capsules for one kind must remain independently actionable.
    await evaluate("window.__sidebarService.openTab('guide')");
    await wait(() => evaluate("document.querySelectorAll('[data-sidebar-right-guide-entry=compat-guide-a]').length===2"));
    await evaluate("document.querySelectorAll('[data-sidebar-right-guide-entry=compat-guide-a]')[1].click()");
    await wait(() => evaluate("document.querySelector('[data-guide-target=a]')?.textContent==='compat-guide-a'"));
    console.log('Guide fallback passed declining/replacing/unloaded chains, ordered multiple entries, late registration, description threshold and guide-to-page replacement.');
  } finally {
    await evaluate("window.__guideFiber.dispose();if(window.__sidebarService.isExpanded())window.__sidebarService.toggleExpanded()");
  }
}
