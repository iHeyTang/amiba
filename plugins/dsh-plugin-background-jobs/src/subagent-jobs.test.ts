// @vitest-environment node
import { expect, it, vi } from "vitest";
import { SubagentJobs } from "./subagent-jobs.js";
function fixture(mode="continuable") {
  const handlers: Record<string, Function>={}; const cleanups: Function[]=[];
  const owner={id:"parent"};
  const child={id:"child",whenIdle:vi.fn(async()=>{}),session:{header:{parentSession:"parent"},events:[{type:"subagent/descriptor",data:{version:2,mode,provider:"spawn",label:"child"}}]}};
  const records:any[]=[];const collectors:Promise<unknown>[]=[];
  const ctx:any={agents:{get:(id:string)=>id==="child"?child:id==="parent"?owner:undefined},subagents:{drainContinuableChildren:vi.fn(async()=>{})},logger:{warn:vi.fn()},
    on:(event:string,fn:Function)=>{handlers[event]=fn;},effect:(fn:Function)=>cleanups.push(fn()),
    jobs:{start:(spec:any)=>{const hooks=spec.run();const row={id:`subagent-turn-${records.length+1}`,status:"running",hooks,spec,reported:false};records.push(row);hooks.done.then((outcome:any)=>Object.assign(row,outcome));return row.id;},
      get:(id:string)=>records.find(row=>row.id===id),
      wait:vi.fn((id:string)=>{const row=records.find(row=>row.id===id);const promise=row.hooks.done.then(()=>{row.reported=true;return row;});collectors.push(promise);return promise;}),
    }};
  const bridge=new SubagentJobs(ctx,{present:vi.fn()} as any);
  const info=(runId:string)=>({runId,id:"child",provider:"spawn",local:true});
  return {handlers,ctx,owner,child,records,bridge,info,cleanups,collectors};
}
it("maps continuation epochs independently and collects the duplicate jobs notification",async()=>{
  const f=fixture();f.handlers["subagent/start"](f.info("r1"));
  expect(f.records).toHaveLength(1);expect(f.ctx.jobs.wait).toHaveBeenCalledWith("subagent-turn-1",2147483647,f.owner);
  f.handlers["subagent/end"]({...f.info("r1"),stopReason:"completed",lastAssistantMessage:[{type:"text",text:"done"}]});await Promise.all(f.collectors);
  expect(f.records[0]).toMatchObject({status:"completed",reported:true});
  f.handlers["subagent/start"](f.info("r2"));expect(f.records[1].id).toBe("subagent-turn-2");
  f.records[1].hooks.cancel();expect(f.ctx.subagents.drainContinuableChildren).toHaveBeenCalledWith(f.owner,["child"]);
  f.handlers["subagent/end"]({...f.info("r2"),stopReason:"aborted"});await Promise.all(f.collectors);
  expect(f.records[1].status).toBe("killed");
});
it("ignores one-shot children already owned by the official job producer",()=>{
  const f=fixture("one-shot");f.handlers["subagent/start"](f.info("r1"));expect(f.records).toHaveLength(0);
});
it("drains the running child on bridge unload without destroying its session",async()=>{
  const f=fixture();f.handlers["subagent/start"](f.info("r1"));for(const close of f.cleanups)await close();await Promise.all(f.collectors);
  expect(f.ctx.subagents.drainContinuableChildren).toHaveBeenCalledWith(f.owner,["child"]);expect(f.records[0].status).toBe("killed");
});
