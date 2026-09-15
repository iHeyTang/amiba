import { isJsonValue } from "@deepseek-ai/dsh-session";
import { describe, expect, it, vi } from "vitest";
import { BackgroundJobs } from "./service.js";
function fixture() {
  const handlers: Record<string, Function> = {};
  const cleanups: Function[] = [];
  let changed: Function;
  let done: Function;
  const owner = { id: "s1", session: { append: vi.fn() } };
  const other = { id: "s2", session: { append: vi.fn() } };
  const records = new Map<string, any>();
  const read = vi.fn(() => { throw new Error("Must never consume output"); });
  const jobs = {
    onJobDone: (fn: Function) => { done = fn; return () => {}; },
    onJobsChanged: (fn: Function) => { changed = fn; return () => {}; },
    list: (agent: any) => [...records.values()].filter(job => job.ownerSession === agent.id),
    get: (id: string, agent: any) => { const job = records.get(id); if (!job || job.ownerSession !== agent.id) throw new Error("Foreign job"); return job; },
    kill: vi.fn((id: string, agent: any) => { jobs.get(id, agent); }), read,
  };
  const domains = new Map<string, Map<string, any>>();
  const storage = { open: async (id: string) => {
    if (!domains.has(id)) domains.set(id,new Map());
    const records = domains.get(id)!;
    return {table:()=>({entries:()=>records.entries(),get:(key:string)=>records.get(key),put:async(key:string,value:any)=>{records.set(key,structuredClone(value));}})};
  }};
  const ctx = { amibaSessionStorage: storage, jobs, agents: { get: (id: string) => id === "s1" ? owner : id === "s2" ? other : undefined },
    on: (key: string, fn: Function) => { handlers[key] = fn; },
    effect: (fn: Function) => cleanups.push(fn()),
  };
  const service = new BackgroundJobs(ctx as any);
  let tick = 0;
  const start = (id = "bash-1", agent = owner) => {
    records.set(id, { id, ownerSession: agent.id, status: "running", kind: "bash", startedAt: ++tick }); changed!(agent);
  };
  const inspect = async (sessionId: string, jobId: string) => {
    const record = (await service.history(sessionId)).filter(row => row.id === jobId).at(-1);
    return service.inspect(sessionId,record?.recordId ?? "absent-record");
  };
  return { inspect, done: (job: any, agent = owner) => done!({...records.get(job.id),...job}, agent), service, handlers, owner, other, jobs, start, cleanups, records, change: () => changed!(owner) };
}
describe("background job presentation boundary", () => {
  it("correlates concurrent calls through async context without reading notices", async () => {
    const f = fixture();
    await Promise.all([1,2].map(i => f.handlers["tools/execute"]({ callId: `call-${i}`, agent: f.owner }, async () => {
      await Promise.resolve(); f.start(`bash-${i}`);
    })));
    expect((await f.inspect("s1", "bash-1")).callId).toBe("call-1");
    expect((await f.inspect("s1", "bash-2")).callId).toBe("call-2");
    expect(f.jobs.read).not.toHaveBeenCalled();
  });
  it("fences inspection, cancellation and producer registration by session", async () => {
    const f = fixture(); f.start();
    await expect(f.inspect("s2", "bash-1")).rejects.toThrow("Task not found");
    const recordId = (await f.service.history("s1"))[0]!.recordId;
    expect(() => f.service.stop("s2", recordId)).toThrow("no longer running");
    expect(() => f.service.present("s2", "bash-1", { title: "wrong" })).toThrow("Foreign job");
    f.service.stop("s1", recordId);
    expect(f.jobs.kill).toHaveBeenLastCalledWith("bash-1", f.owner, "Stopped by the user");
  });
  it("uses independent producer previews and disposes them without affecting execution", async () => {
    const f = fixture(); f.start();
    const detach = f.service.present("s1", "bash-1", { title: "测试", peekOutput: () => "output" });
    expect(await f.inspect("s1", "bash-1")).toMatchObject({ title: "测试", output: "output", liveOutput: true });
    detach();
    expect((await f.inspect("s1", "bash-1")).output).toBe("output");
    expect(f.jobs.read).not.toHaveBeenCalled();
    expect(f.jobs.kill).not.toHaveBeenCalled();
  });
  it("keeps already-observed output bounded and removes stale metadata", async () => {
    const f = fixture(); f.start();
    f.handlers["tools/result"]({ agent: f.owner, arguments: { job_id: "bash-1" } }, { content: [{ type: "text", text: "x".repeat(100000) }] });
    expect((await f.inspect("s1", "bash-1")).output.length).toBe(65536);
    f.records.clear(); f.change(); f.start();
    expect((await f.inspect("s1", "bash-1")).output).toBe("");
  });
});

it("publishes structured completion for arbitrary producers without leaking raw labels", async () => {
  const f = fixture(); f.start("custom-1");
  await f.done({ id: "custom-1", kind: "third-party-build", status: "completed", startedAt: 1000, finishedAt: 4000, label: "SECRET=private" });
  expect(f.owner.session.append).toHaveBeenCalledWith("amiba/notice", expect.objectContaining({
    version: 1, summary: "后台任务 · 已完成", body: "后台任务 · 已完成\n耗时 3 秒",
    reference: { kind: "background-job", sessionId: "s1", id: expect.any(String), instance: "1000" },
  }), {ignorable: true});
  expect(JSON.stringify(f.owner.session.append.mock.calls)).not.toContain("SECRET");
  expect(f.jobs.read).not.toHaveBeenCalled();
});

it("preserves dispatch ownership when another call is active at completion", async () => {
  const f=fixture();
  await f.handlers["tools/execute"]({callId:"nested",rootCallId:"dispatch",agent:f.owner},async()=>f.start("tool-1"));
  await f.handlers["tools/execute"]({callId:"unrelated",agent:f.owner},async()=>f.done({id:"tool-1",status:"completed",startedAt:1000,finishedAt:2000}));
  expect(f.owner.session.append).toHaveBeenCalledWith("amiba/notice",expect.objectContaining({placement:{kind:"execution",sessionId:"s1",callId:"dispatch"}}),{ignorable:true});
});

it("writes an ignorable envelope using the real official Session append implementation", async () => {
  const { Session } = await import("@deepseek-ai/dsh-session");
  const { appendPresentationNotice } = await import("./notice.js");
  const session=Session.create("notice-roundtrip" as any);
  appendPresentationNotice(session,{version:1,id:"n1",source:"test",summary:"Done",body:"Result"});
  const serialized=JSON.parse(JSON.stringify(session.snapshotEvents()));
  expect(serialized[0]).toMatchObject({type:"amiba/notice",ignorable:true});
  const restored=Session.create("notice-roundtrip" as any,serialized);
  expect(restored.snapshotEvents()[0]).toEqual(session.snapshotEvents()[0]);
});

it("returns JSON-safe native job details and relations without absent optional fields", async () => {
  const f=fixture(); f.start("bash-native");
  f.service.present("s1","bash-native",{title:"后台等待测试"});
  const detail=await f.inspect("s1","bash-native");
  expect(isJsonValue(detail)).toBe(true);
  expect(detail).not.toHaveProperty("toolName");
  expect(detail).not.toHaveProperty("callId");
  expect(detail).toEqual(JSON.parse(JSON.stringify(detail)));
  const relations=await f.service.history("s1");
  expect(isJsonValue(relations)).toBe(true);
  expect(relations[0]).not.toHaveProperty("callId");
  expect(relations).toEqual(JSON.parse(JSON.stringify(relations)));
});

it("rejects runtime job ids at presentation RPC boundaries", async () => {
  const f=fixture();f.start("bash-1");await f.service.flushAll();
  await expect(f.service.inspect("s1","bash-1")).rejects.toThrow("Task not found");
  expect(()=>f.service.stop("s1","bash-1")).toThrow("Task record not found");
});

it("records canonical job output without the control footer or duplicate final reads",async()=>{
 const f=fixture();f.start();
 const exec={name:"job_output",agent:f.owner,callId:"collect",arguments:{job_id:"bash-1"}};
 const result={isError:false,value:{text:"DONE\n",job:{status:"completed"}},content:[{type:"text",text:"DONE\nstatus completed internal-id"}]};
 f.handlers["tools/result"](exec,result);f.handlers["tools/result"](exec,result);
 expect((await f.inspect("s1","bash-1")).output).toBe("DONE\n");
});

it("persists command identity from the original tool invocation",async()=>{
 const f=fixture();
 await f.handlers["tools/execute"]({name:"bash",callId:"command-call",agent:f.owner,arguments:{command:"sleep 30; echo DONE"}},async()=>f.start());
 const record=(await f.service.history("s1"))[0];
 expect(record).toMatchObject({callId:"command-call",toolName:"bash",command:"sleep 30; echo DONE"});
});
