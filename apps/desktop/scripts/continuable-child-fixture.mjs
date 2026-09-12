import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Test-only model adapter. Real DSH agents, inboxes, subagent ownership and
// event transports remain in use; no external model request is necessary.
export function continuableChildFixture(root, profile) {
  const adapterUrl = pathToFileURL(path.join(root, 'packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-llm/lib/index.js')).href;
  return `
    const adapterUrl = ${JSON.stringify(adapterUrl)};
    const { LlmAdapter } = await import(adapterUrl);
    class FixtureAdapter extends LlmAdapter {
      async *stream(options:any) {
        const input = options.messages.filter((m:any)=>m.role==='user')
          .flatMap((m:any)=>m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text))
          .reverse().find((text:string)=>/^COMPAT_(INITIAL_CHILD|NATIVE_FOLLOWUP|COLD_FOLLOWUP|NESTED_CREATE|NESTED_INITIAL|NESTED_FOLLOWUP|NESTED_PARENT_WAKE|WAIT_FOR_STOP)$/.test(text)) || '';
        if(input==='COMPAT_NESTED_CREATE' && options.sessionId==='compat-continuable-child' && !nestedCreated) {
          nestedCreated=true;
          const parent=ctx.agents.get('compat-continuable-child');
          await ctx.subagents.startContinuable({provider:'spawn',label:'Nested compatibility child',childId:'compat-nested-child',
            request:{parent,prompt:[{type:'text',text:'COMPAT_NESTED_INITIAL'}],agentOptions:{provider:'compat-local',model:'fixture'}},
            signal:new AbortController().signal,
          });
          console.log('AMIBA_PROBE_NESTED_CREATED');
        }
        const text = options.sessionId==='compat-continuable-child'
          ? 'COMPAT_CONTINUABLE_REPLY '+input : options.sessionId==='compat-nested-child' ? 'COMPAT_NESTED_REPLY '+input : 'COMPAT_PARENT_SETTLED';
        console.log('AMIBA_PROBE_MODEL '+options.sessionId+' '+input);
        const literal=options.messages.filter((m:any)=>m.role==='user').flatMap((m:any)=>m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text)).find((text:string)=>text.startsWith('COMPAT_LITERAL_'));
        if(literal) console.log('AMIBA_PROBE_LITERAL_INPUT '+options.sessionId+' '+JSON.stringify(literal));
        yield {type:'block-start',index:0,blockType:'text'};
        yield {type:'text-delta',index:0,text};
        if((input.includes('COMPAT_WAIT_FOR_STOP') || input.includes('COMPAT_NESTED_PARENT_WAKE')) && options.sessionId==='compat-continuable-child') {
          await new Promise<void>((resolve)=>{
            if(options.signal?.aborted) return resolve();
            options.signal?.addEventListener('abort',()=>resolve(),{once:true});
          });
          console.log('AMIBA_PROBE_CHILD_ABORTED');
          options.signal?.throwIfAborted();
        }
        yield {type:'block-end',index:0,block:{type:'text',text}};
        yield {type:'finish',reason:{kind:'stop'}};
      }
    }
    const registration=ctx.llm.registerAdapter(['compat-local'],new FixtureAdapter());
    ctx.effect(()=>()=>registration());
    let started=false;
    let nestedCreated=false;
    ctx.effect(()=>{
      const watcher=watch(${JSON.stringify(profile)},()=>{
        if(started || existsSync(${JSON.stringify(path.join(profile, 'cold-restart'))}) || !existsSync(${JSON.stringify(path.join(profile, 'continuable-create'))}))return;
        started=true;
        void (async()=>{
          const parent=await ctx.agents.create({sessionId:'compat-continuable-parent',meta:{cwd:${JSON.stringify(path.join(profile, 'continuable'))}},agentOptions:{provider:'compat-local',model:'fixture'}});
          ctx.effect(()=>()=>parent.dispose());
          const accepted=await ctx.subagents.startContinuable({
            provider:'spawn',label:'Continuable compatibility child',childId:'compat-continuable-child',
            request:{parent:parent.agent,prompt:[{type:'text',text:'COMPAT_INITIAL_CHILD'}],agentOptions:{provider:'compat-local',model:'fixture'}},
            signal:new AbortController().signal,
          });
          console.log('AMIBA_PROBE_CONTINUABLE '+JSON.stringify(accepted));
        })().catch(error=>console.error('AMIBA_PROBE_CONTINUABLE_ERROR',error));
      });
      return ()=>watcher.close();
    });
  `;
}
