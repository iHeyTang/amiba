import assert from 'node:assert/strict';

/** Exercise the actual desktop service and Cordis ownership, without claiming a rendered tab. */
export async function smokeRightTabRegistry(evaluate) {
  const result = await evaluate(`(async () => {
    const ctx=window.__probeCtx;
    let tabs,offBuiltin,extension;
    const owner=await ctx.inject(['sidebarRightTabs'],child=>{
      tabs=child.sidebarRightTabs;
      offBuiltin=tabs.register({id:'compat/base-text',kind:'compat-text',priority:'builtin',patterns:['dsh-resource://file/**'],title:address=>'Base '+address});
      child.effect(()=>offBuiltin,'compat base viewer');
    });
    const address='dsh-resource://file/session/compat/project/NOTES.MD';
    const baseline=tabs.claim(address);
    const baselineDefinition=tabs.get('compat-text');
    extension=await ctx.inject(['sidebarRightTabs'],child=>{
      child.effect(()=>child.sidebarRightTabs.register({id:'compat/custom-text',kind:'compat-text',patterns:['*.md'],title:()=> 'Custom notes',guide:[{order:3,title:()=> 'Open notes'}]}),'compat custom viewer');
    });
    const takeover=tabs.get('compat-text').id==='compat/custom-text'&&tabs.claim(address).title==='Custom notes';
    const guide=tabs.guide().some(entry=>entry.kind==='compat-text'&&entry.title()==='Open notes');
    const before=tabs.entries();
    let conflict=false;
    try {tabs.register({id:'compat/collision',kind:'compat-text',title:()=> 'Invalid'})} catch(error) {conflict=error.message.includes('already registered')}
    const atomic=tabs.entries()===before;
    await extension.dispose();
    const restored=tabs.get('compat-text')===baselineDefinition&&tabs.claim(address).title===baseline.title;
    const cleanGuide=!tabs.guide().some(entry=>entry.kind==='compat-text');
    await owner.dispose();
    const removed=tabs.get('compat-text')===undefined&&!tabs.entries().some(entry=>entry.id.startsWith('compat/'));
    return {takeover,guide,conflict,atomic,restored,cleanGuide,removed};
  })()`);
  assert.deepEqual(result,{takeover:true,guide:true,conflict:true,atomic:true,restored:true,cleanGuide:true,removed:true});
  console.log('Right tab registry passed actual service injection, address claims, extension takeover, duplicate rollback and caller fiber unload restoring and removing definitions.');
}
