import assert from 'node:assert/strict';

export async function smokeLayoutNavigation(evaluate) {
  const result = await evaluate(`(() => {
    const layout=window.__probeCtx.layout;
    const first=layout.beginNavigation();
    const second=layout.beginNavigation();
    const superseded=first.aborted&&!second.aborted;
    window.dispatchEvent(new CustomEvent('amiba:dsh-layout-action',{detail:{action:'unrelated-probe'}}));
    const unrelatedPreserved=!second.aborted;
    layout.openChat();
    const committed=second.aborted;
    const third=layout.beginNavigation();
    window.dispatchEvent(new CustomEvent('amiba:dsh-layout-action',{detail:{action:'open-chat'}}));
    return {superseded,unrelatedPreserved,committed,nativeEvent:third.aborted};
  })()`);
  assert.deepEqual(result,{superseded:true,unrelatedPreserved:true,committed:true,nativeEvent:true});
  console.log('Layout navigation passed real service replacement, committed navigation cancellation, native event cancellation and unrelated event preservation.');
}
