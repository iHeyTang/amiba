import path from 'node:path';

/** Exercise the actual Host configuration loader in the isolated smoke profile. */
export function lineageLoaderFixture(profile) {
  const file = name => JSON.stringify(path.join(profile, name));
  return `ctx.effect(()=>{
    let creating=false;let removing=false;let entryId:string|undefined;
    const watcher=watch(${JSON.stringify(profile)},async()=>{
      try {
        if(existsSync(${file('lineage-enable')})&&!creating){
          creating=true;
          entryId=await ctx.loader.create({name:'@deepseek-ai/dsh-client-ui-subagent'});
          writeFileSync(${file('lineage-enabled.json')},JSON.stringify({entryId,graph:ctx.clientModules.graph().entries.map(e=>({id:e.id,inject:e.inject}))}));
        }
        if(entryId&&existsSync(${file('lineage-disable')})&&!removing){
          removing=true;
          await ctx.loader.remove(entryId);
          writeFileSync(${file('lineage-disabled.json')},JSON.stringify({entryId,graph:ctx.clientModules.graph().entries.map(e=>({id:e.id,inject:e.inject}))}));
        }
      } catch(error) {writeFileSync(${file('lineage-loader-error.txt')},String(error));}
    });
    return ()=>watcher.close();
  });`;
}
