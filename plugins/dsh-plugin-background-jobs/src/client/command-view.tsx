import {Terminal} from "lucide-react";
import {useEffect, useState, useSyncExternalStore} from "react";
import type {PropsRuntime} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import {ToolRowFrame, toolCallArgs, stringValue, toolCallDurationMs, toolCallStartedAt, toolCallSettled, toolCallFailed} from "@amiba/ui/plugin";
import type {Relations} from "./relations.js";
import {commandOutput} from "./command-output.js";
import {taskRows} from "./history.js";
export const isCommand = (job: {kind:string;callId?:string}) => !!job.callId && ["bash","pwsh","pty-send"].includes(job.kind);
const states:Record<string,string>={running:"运行中",stopping:"停止中",completed:"已完成",failed:"失败",killed:"已取消",interrupted:"已中断"};
const empty:never[]=[];
type Props = PropsRuntime<"amiba.tool.execution"> & {relations:Relations;api:ClientContext["remote"]["amibaJobs"]};
function argsInCalls(calls: readonly Props["block"][], callId: string): Record<string, unknown> | undefined {
  for (const call of calls) {
    if (call.callId === callId) return toolCallArgs(call);
    const nested = argsInCalls(call.subCalls, callId);
    if (nested) return nested;
  }
}
export function CommandExecution(props:Props) {
  const {sessionId,callId,relations,api,presentation,fallback,revealVersion}=props;
  const records=useSyncExternalStore(relations.subscribe,()=>relations.get(sessionId));
  const live=props.useSessions(s=>s.jobsBySession[sessionId]) ?? empty;
  const args = toolCallArgs(props.block);
  const record=records.find(r=>r.callId===callId || r.resultCallIds.includes(callId))
    ?? (props.toolName === "job_output" ? [...records].reverse().find(r=>r.id === args.job_id) : undefined);
  const sourceArgs = props.useSession(snapshot => {
    if (!record?.callId || snapshot.sessionId !== sessionId) return undefined;
    const calls = snapshot.nodes.filter(node => node.kind === "tool-result");
    return argsInCalls(calls, record.callId) || argsInCalls(snapshot.runningCalls, record.callId);
  });
  const job=record && taskRows(live,[record])[0];
  const [open,setOpen]=useState(false);
  const [output,setOutput]=useState("");
  const [error,setError]=useState("");
  const [stopping,setStopping]=useState(false);
  const [now,setNow]=useState(Date.now);
  const callStartedAt = toolCallStartedAt(props.block);
  const running=job?.status === "running" || job?.status === "stopping";
  useEffect(()=>{if(revealVersion)setOpen(true);},[revealVersion]);
  useEffect(()=>{if(!running && callStartedAt === undefined)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running,callStartedAt]);
  useEffect(()=>{
    if(!open || !record || !isCommand(record) || presentation === "summary")return;
    let active=true;let timer:ReturnType<typeof setTimeout>;
    async function read(){try{const result=await api.inspect(sessionId,record!.recordId);if(!result.ok)throw new Error();if(active){setOutput(result.value.output);setError("");}}catch{if(active)setError("暂时无法读取输出，请重试");}if(active&&running)timer=setTimeout(read,2000);}
    void read();return()=>{active=false;clearTimeout(timer);};
  },[open,sessionId,record?.recordId,record?.updatedAt,running,api,presentation]);
  if (record?.kind === "media" && record.callId && props.toolName === "job_output") {
    // Repeated successful reads add no new work. Keep the original generation
    // row as the owner, but preserve failed reads and explicit inspection.
    const settled = toolCallSettled(props.block) !== null;
    if (!toolCallFailed(props.block) && presentation !== "summary" && !revealVersion) return null;
    if (toolCallFailed(props.block)) return <>{fallback}</>;
    const operation = stringValue(sourceArgs ?? {}, "operation");
    const subject = operation.startsWith("image.") ? "图片" : operation.startsWith("video.") ? "视频" : /^(speech|audio)\./.test(operation) ? "音频" : "媒体";
    const action = job?.status === "completed" ? `${subject}生成完成` : `等待${subject}生成结果`;
    return <ToolRowFrame presentation={presentation} icon={Terminal} action={action}
      running={!settled} detail={<button type="button" onClick={()=>props.revealToolCall?.(record.callId!)}>查看生成任务</button>}/>;
  }
  if(!record || !job || !isCommand(record))return <>{fallback}</>;
  const command=record.command || stringValue(sourceArgs ?? {}, "command") || (record.callId === callId ? stringValue(toolCallArgs(props.block),"command") : undefined);
  const seconds=Math.max(0,Math.floor(((job.finishedAt ?? now)-job.startedAt)/1000));
  const elapsed=job.status === "interrupted" ? "耗时未知" : seconds<60 ? `${seconds} 秒` : `${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
  const renderedOutput = commandOutput(output, job.status);
  const visibleOutput = renderedOutput.text;
  const collecting = record.callId !== callId;
  const callMs = toolCallDurationMs(props.block) ?? (callStartedAt === undefined ? undefined : Math.max(0, now - callStartedAt));
  const label = collecting ? "获取执行结果" : "运行命令";
  return <div className="amiba-command" data-state={job.status}>
    <ToolRowFrame
      presentation={presentation}
      icon={Terminal}
      action={label}
      target={command}
      durationMs={callMs}
      running={toolCallSettled(props.block) === null}
      failed={toolCallFailed(props.block)}
      expanded={open}
      onExpandedChange={setOpen}
      detail={<>
        {error && <p role="alert">{error}</p>}
        <div className="amiba-command-output">
          {command && <pre className="amiba-command-source">$ {command}</pre>}
          {renderedOutput.exitCode !== undefined && renderedOutput.exitCode !== 0 && <p className="amiba-command-exit" role="status">退出码 {renderedOutput.exitCode}</p>}
          {visibleOutput ? <pre className="amiba-command-text">{visibleOutput}</pre> : <p className="amiba-command-empty">{running?"等待输出…":"暂无输出"}</p>}
          <div className="amiba-command-runtime">
            <span><i aria-hidden="true"/>{states[job.status]}</span>
            <span>实际运行 {elapsed}</span>
            {running && !collecting && <button className="amiba-command-stop" disabled={stopping || job.status === "stopping"} onClick={async()=>{setStopping(true);try{const result=await api.stop(sessionId,record.recordId);if(!result.ok)throw new Error();}catch{setError("停止失败，请重试");}finally{setStopping(false);}}}>停止</button>}
          </div>
        </div>
      </>}
    />
  </div>;
}
