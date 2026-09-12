import path from 'node:path';

/** Mutate only the isolated smoke profile's root loader entries. */
export function trajectoryLoaderFixture(profile) {
  const file = name => JSON.stringify(path.join(profile, name));
  return `ctx.effect(()=>{
    let creating=false;let removing=false;let entryId:string|undefined;
    const watcher=watch(${JSON.stringify(profile)},async()=>{
      try {
        if(existsSync(${file('trajectory-enable')})&&!creating){
          creating=true;
          entryId=await ctx.loader.create({name:'@deepseek-ai/dsh-client-ui-trajectory'});
          await new Promise(resolve=>setTimeout(resolve,100));
          writeFileSync(${file('trajectory-enabled.json')},JSON.stringify({entryId,entries:[...ctx.loader.entries()].filter(e=>e.options.name.includes('trajectory')).map(e=>({id:e.id,name:e.options.name,disabled:e.disabled,state:e.fiber?.state})),graph:ctx.clientModules.graph().entries.filter(e=>/trajectory|ui-conversation/.test(e.id)).map(e=>({id:e.id,inject:e.inject}))}));
        }
        if(entryId&&existsSync(${file('trajectory-disable')})&&!removing){
          removing=true;
          await ctx.loader.remove(entryId);
          writeFileSync(${file('trajectory-disabled.json')},JSON.stringify({entryId}));
        }
      } catch(error) {writeFileSync(${file('trajectory-loader-error.txt')},String(error));}
    });
    return ()=>watcher.close();
  });`;
}
