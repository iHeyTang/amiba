import {CommandExecution, isCommand} from "./command-view.js";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { JOBS_REMOTE, type JobDetail } from "../remote.js";
import { createRelations, type Relations } from "./relations.js";
import { JobResult } from "./job-result.js";
import { taskRows } from "./history.js";
import css from "./style.css?inline";

export const name = "amiba-background-jobs-ui";
export const inject = ["slots", "remote"];
type Api = ClientContext["remote"]["amibaJobs"];
async function value<T>(request: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>): Promise<T> {
  const result = await request;
  if (!result.ok) throw new Error("无法读取任务状态，请检查连接后重试");
  return result.value;
}
const EMPTY: never[] = [];
const states: Record<string, string> = { running: "运行中", stopping: "停止中", completed: "已完成", failed: "失败", killed: "已取消", interrupted: "已中断" };
function elapsed(start: number, end: number) { const s = Math.max(0, Math.floor((end - start) / 1000)); return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`; }

type WorkbenchProps = PropsRuntime<"amiba.workbench.panel"> & { api: Api; relations: Relations };

function JobOutput({ sessionId, jobId, api, inspectToolCall, renderMarkdown, running, revision }: Pick<WorkbenchProps, "sessionId" | "api" | "inspectToolCall" | "renderMarkdown"> & { jobId: string; running: boolean; revision?: number }) {
  const [detail, setDetail] = useState<JobDetail>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try { const next = await value(api.inspect(sessionId, jobId)); if (active) { setDetail(next); setError(""); } }
      catch { if (active) setError("暂时无法读取任务详情，请稍后重新展开。"); }
      if (active && running) timer = setTimeout(read, 2000);
    };
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [sessionId, jobId, api, running, revision]);
  return <div className="amiba-jobs-detail">
    {error && <p role="alert">{error}</p>}
    {!detail && !error && <p role="status">正在读取任务详情…</p>}
    {detail && <>
      {!detail.outputAvailable || !detail.output.trim()
        ? <p className="amiba-jobs-result-empty" role="status">{running ? "等待输出…" : "暂无输出"}</p>
        : <JobResult detail={detail} renderMarkdown={renderMarkdown}/>}
      {detail.callId && <div className="amiba-jobs-output-footer"><button onClick={() => { if (!inspectToolCall(detail.callId!)) setError("调用记录尚未载入，请稍后重试"); }} title="查看派出任务时的工具调用">查看调用记录 <span aria-hidden="true">↗</span></button></div>}

    </>}
  </div>;
}

export function Activity({ sessionId, useSessions, api, inspectToolCall, renderMarkdown, relations }: WorkbenchProps) {
  const liveJobs = useSessions(state => state.jobsBySession[sessionId]) ?? EMPTY;
  const metadata = useSyncExternalStore(relations.subscribe, () => relations.get(sessionId));
  const jobs = taskRows(liveJobs, metadata);
  const loadError = useSyncExternalStore(relations.subscribe, () => relations.error(sessionId));
  const openVersion = useSyncExternalStore(relations.subscribe, () => relations.openVersion(sessionId));
  const appliedOpen = useRef({sessionId: "", version: 0});
  const [expanded, expand] = useState<Set<string>>(new Set());
  const [endedOpen, setEndedOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(true);
  const [now, setNow] = useState(Date.now);
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { expand(new Set()); setEndedOpen(false); setLiveOpen(true); setErrors({}); setStopping(new Set()); }, [sessionId]);
  useEffect(() => {
    const id = relations.requestedJob(sessionId);
    if (id && openVersion && (appliedOpen.current.sessionId !== sessionId || appliedOpen.current.version !== openVersion)) {
      expand(current => new Set([...current, id]));
      const job = jobs.find(job => job.id === id);
      if (job) {
        if(isCommand(job))inspectToolCall(job.callId!);
        if (job.status !== "running" && job.status !== "stopping") setEndedOpen(true); else setLiveOpen(true);
        appliedOpen.current = {sessionId, version: openVersion};
      }
    }
  }, [openVersion, sessionId, relations, metadata]);
  const live = jobs.filter(job => job.status === "running" || job.status === "stopping");
  useEffect(() => { if (!live.length) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [live.length]);
  const ended = jobs.filter(job => job.status !== "running" && job.status !== "stopping");
  return <section className="amiba-jobs" aria-label="后台任务">
    {loadError && <p role="alert">{loadError}</p>}
    {!jobs.length && !loadError ? <div className="amiba-jobs-empty-state">
      <div className="amiba-jobs-empty-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h5M8 16h3"/><circle cx="18" cy="17" r="4" fill="hsl(var(--background))"/><path d="M18 15v2l1 1"/></svg></div>
      <h3>还没有后台任务</h3>
      <p>交给助手的后台工作会集中显示在这里。<br/>你可以继续对话，随时查看进度和结果。</p>
      <span className="amiba-jobs-empty-hint">例如：在后台运行测试，完成后告诉我结果</span>
    </div> : <div className="amiba-jobs-panel">
      {[{label: "进行中", items: live}, {label: "已结束", items: ended}].map(group => <section key={group.label} aria-label={group.label} className="amiba-jobs-group">
        <h3><button className="amiba-jobs-group-toggle" aria-expanded={group.label === "已结束" ? endedOpen : liveOpen} aria-controls={`${group.label === "已结束" ? "ended" : "live"}-jobs-${sessionId}`} onClick={() => group.label === "已结束" ? setEndedOpen(value => !value) : setLiveOpen(value => !value)}>
          <svg className="amiba-jobs-chevron" data-open={group.label === "已结束" ? endedOpen : liveOpen} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>
          <span className="amiba-jobs-group-label">{group.label}</span><span className="amiba-jobs-count">{group.items.length}</span>
        </button></h3>
        <ul id={`${group.label === "已结束" ? "ended" : "live"}-jobs-${sessionId}`} className="amiba-jobs-list">{[...(!(group.label === "已结束" ? endedOpen : liveOpen) ? [] : group.items)].sort((a,b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt)).map(job => {
          const open = expanded.has(job.id);
          const running = job.status === "running" || job.status === "stopping";
          return <li key={job.id} className="amiba-jobs-item" data-state={job.status} data-expanded={open}>
            <div className="amiba-jobs-row">
              <button className="amiba-jobs-toggle" disabled={!job.recordId} aria-expanded={open} aria-controls={`job-${sessionId}-${job.id}`} onClick={() => { if(isCommand(job)){ if(!inspectToolCall(job.callId!))setErrors(current=>({...current,[job.id]:"原命令尚未载入"}));return;} expand(current => { const next = new Set(current); if (open) next.delete(job.id); else next.add(job.id); return next; });}}>
                <svg className="amiba-jobs-chevron" data-open={open} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>
                <span className="amiba-jobs-summary" title={job.title || job.command || (isCommand(job) ? "运行命令" : "未命名任务")}><strong>{job.title || job.command || (isCommand(job) ? "运行命令" : "未命名任务")}</strong></span><span className="amiba-jobs-meta"><span><i aria-hidden="true"/>{states[job.status]}</span><span>{job.status === "interrupted" ? "耗时未知" : elapsed(job.startedAt, job.finishedAt ?? now)}</span></span>
              </button>
              {running && <button className="amiba-jobs-stop" disabled={!job.recordId || job.status === "stopping" || stopping.has(job.id)} onClick={async () => {
                setStopping(current => new Set([...current, job.id])); setErrors(current => ({...current, [job.id]: ""}));
                try { await value(api.stop(sessionId, job.id)); } catch { setErrors(current => ({...current, [job.id]: "停止失败，请重试"})); }
                finally { setStopping(current => { const next = new Set(current); next.delete(job.id); return next; }); }
              }}>{job.status === "stopping" || stopping.has(job.id) ? "停止中" : "停止"}</button>}
            </div>
            {errors[job.id] && <p className="amiba-jobs-row-error" role="alert">{errors[job.id]}</p>}
            {open && !isCommand(job) && <div id={`job-${sessionId}-${job.id}`}><JobOutput sessionId={sessionId} jobId={job.id} api={api} inspectToolCall={inspectToolCall} renderMarkdown={renderMarkdown} running={running} revision={job.updatedAt}/></div>}
          </li>;
        })}</ul>
      </section>)}
    </div>}
  </section>;
}
function WorkbenchTab({ sessionId, useSessions, api, relations, openPanel, activePanel, inspectToolCall }: WorkbenchProps) {
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? EMPTY;
  const live = jobs.filter(job => job.status === "running" || job.status === "stopping");
  const openVersion = useSyncExternalStore(relations.subscribe, () => relations.openVersion(sessionId));
  const metadata = useSyncExternalStore(relations.subscribe,()=>relations.get(sessionId));
  const handled = useRef(0);
  useEffect(() => {
    if (!openVersion || handled.current === openVersion) return;
    const target = metadata.find(row=>row.recordId === relations.requestedJob(sessionId));
    if (target && isCommand(target)) { if(inspectToolCall(target.callId!)) handled.current=openVersion; }
    else {handled.current=openVersion;openPanel("background-jobs");}
  }, [openVersion, sessionId, openPanel, metadata, inspectToolCall, relations]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const rows = await value(api.relations(sessionId)); if (active) { relations.set(sessionId, rows); relations.setError(sessionId, ""); } }
      catch { if (active) relations.setError(sessionId, "任务记录暂时无法读取，正在重试。"); }
      if (active) timer = setTimeout(refresh, 3000);
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [sessionId, jobs, api, relations]);
  return <button type="button" role="tab" aria-selected={activePanel === "background-jobs"} onClick={() => openPanel("background-jobs")} className="amiba-jobs-tab">
    后台任务{live.length > 0 && <span className="amiba-jobs-live" aria-label={`${live.length} 个任务进行中`}>{live.length}</span>}
  </button>;
}
export function WorkbenchActivity(props: WorkbenchProps) {
  return props.placement === "tab" ? <WorkbenchTab {...props}/> : props.activePanel === "background-jobs" ? <Activity {...props}/> : null;
}
/** Live status belongs to the conversation flow, independent of folded history. */
export function RunningJobs({ sessionId, useSessions, relations }: PropsRuntime<"amiba.conversation.progress"> & { relations: Relations }) {
  const liveJobs = useSessions(state => state.jobsBySession[sessionId]) ?? EMPTY;
  const metadata = useSyncExternalStore(relations.subscribe, () => relations.get(sessionId));
  const jobs = taskRows(liveJobs, metadata);
  const running = jobs.filter(job => (job.status === "running" || job.status === "stopping") && !(job.kind === "media" && job.callId));
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!running.length) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [running.length, sessionId]);
  if (!running.length) return null;
  return <section className="amiba-jobs-progress" aria-label="进行中的后台任务">
    {running.map(job => <button key={job.id} disabled={!job.recordId} onClick={() => relations.open(sessionId, job.id)} title="查看执行记录" aria-label={`${job.title || job.command || "正在处理"}，${states[job.status]}，在工作台查看任务`}>
      <span className="amiba-jobs-progress-dot" aria-hidden="true"/>
      <span className="amiba-jobs-progress-title">{job.title || job.command || "正在处理"}</span>
      <span className="amiba-jobs-progress-time">{job.status === "stopping" ? "停止中 · " : ""}{elapsed(job.startedAt, now)}</span>
    </button>)}
  </section>;
}
export function Notice({ sessionId, useSessions, summary, reference, relations }: PropsRuntime<"amiba.conversation.notice"> & { relations: Relations }) {
  const liveJobs = useSessions(state => state.jobsBySession[sessionId]) ?? EMPTY;
  const metadata = useSyncExternalStore(relations.subscribe, () => relations.get(sessionId));
  const jobs = taskRows(liveJobs, metadata);
  if (!reference || reference.kind !== "background-job" || reference.sessionId !== sessionId || !reference.instance) {
    throw new Error("Invalid background task notice reference");
  }
  const target = jobs.find(job => job.recordId === reference.id && reference.instance === String(job.startedAt));
  if (target && (isCommand(target) || (target.kind === "media" && target.callId))) return null;
  return <button className="amiba-jobs-notice" disabled={!target} title={target ? "查看任务" : "任务记录未加载或不存在"} onClick={() => relations.open(sessionId, reference.id)}>{summary} · 查看任务</button>;
}
export async function apply(ctx: ClientContext) {
  const relations = createRelations();
  ctx.effect(() => () => relations.clear(), "background-jobs: relations");
  const style = document.createElement("style"); style.textContent = css; document.head.append(style);
  ctx.effect(() => () => style.remove(), "background-jobs: styles");
  const unmount = await ctx.remote.$mount(JOBS_REMOTE);
  const fiber = ctx.inject(["slots", "remote.amibaJobs"], child => {
    const dispose = child.slots.inject("amiba.workbench.panel", () => child.slots.register({
      name: "amiba.workbench.panel", id: "background-jobs", order: 20,
      inject: () => ({ api: child.remote.amibaJobs, relations }),
    }, WorkbenchActivity));
    const command = child.slots.inject("amiba.tool.execution",()=>child.slots.register({name:"amiba.tool.execution",inject:()=>({relations,api:child.remote.amibaJobs})},CommandExecution));
    const progress = child.slots.inject("amiba.conversation.progress", () => child.slots.register({
      name: "amiba.conversation.progress", id: "background-jobs", order: 20,
      inject: () => ({relations}),
    }, RunningJobs));
    const notice = child.slots.inject("amiba.conversation.notice", () => child.slots.register({
      name: "amiba.conversation.notice", key: "reference:background-job", priority: 20,
      inject: () => ({ relations }),
    }, Notice));
    // Upstream model-context notice duplicates the structured UI completion.
    // Current official model delivery is separate from this plugin's UI notice.
    const modelNotice = child.slots.inject("amiba.conversation.notice", () => child.slots.register({
      name: "amiba.conversation.notice", key: "tool-jobs", priority: 20,
    }, () => null));
    const source = child.slots.inject("amiba.message.source", () => child.slots.register({
      name: "amiba.message.source", id: "tool-jobs", label: () => "后台任务", order: 20,
    }, () => null));
    return () => { dispose(); command(); progress(); notice(); modelNotice(); source(); };
  });
  return async () => { await fiber.dispose(); unmount(); };
}
