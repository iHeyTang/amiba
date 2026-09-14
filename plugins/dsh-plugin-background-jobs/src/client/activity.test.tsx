import type { JobRelation } from "../remote.js";
function completeRelations(rows: Partial<JobRelation>[]): JobRelation[] {
  return rows.map(row => ({id:"job",recordId:row.id ?? "record",title:"",kind:"subagent",status:"completed",startedAt:fixtureStart,updatedAt:fixtureStart,resultCallIds:[],...row}));
}
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Activity, WorkbenchActivity, apply } from "./index.js";
import { createRelations } from "./relations.js";
afterEach(cleanup);
const fixtureStart = Date.now()-3000;
function fixture() {
  const jobs = [{ id: "bash-1", kind: "subagent", label: "export PRIVATE_KEY=do-not-display", status: "running", startedAt: fixtureStart }];
  const relations = createRelations();
  const api = { relations: vi.fn(async () => ({ok: true, value: completeRelations([{id:"bash-1",callId:"call-1",title:"运行测试"}])})),
    inspect: vi.fn(async () => ({ok: true,value:{sessionId:"s1",id:"bash-1",callId:"call-1",title:"运行测试",output:"hello",outputAvailable:true,liveOutput:false}})),
    stop: vi.fn(async () => ({ok: true,value:true})),
  };
  const props = { sessionId:"s1", useSessions:(fn: any)=>fn({jobsBySession:{s1:jobs}}), api, relations, placement:"tab", activePanel:null, openPanel:vi.fn(), renderMarkdown: (text: string)=><div>{text}</div>, inspectToolCall: vi.fn(()=>true) };
  relations.set("s1",completeRelations([{id:"bash-1",callId:"call-1",title:"运行测试"}]));
  return {props, jobs};
}
describe("session workbench jobs", () => {
  it("renders grouped tasks in the workbench, with output, original call and stop", async () => {
    const {props}=fixture(); render(<Activity {...props as any}/>);
    expect(document.querySelector(".amiba-dock-sheet")).toBeNull();
    expect(within(screen.getByRole("region",{name:"进行中"})).getByText("运行测试")).toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_KEY/)).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:/运行测试/}));
    await screen.findByText("hello");
    fireEvent.click(screen.getByText("查看调用记录"));
    expect(props.inspectToolCall).toHaveBeenCalledWith("call-1");
    fireEvent.click(screen.getByText("停止"));
    await waitFor(()=>expect(props.api.stop).toHaveBeenCalledWith("s1","bash-1"));
  });
  it("expands each task inline independently and collapses its output", async () => {
    const {props,jobs}=fixture();
    jobs.push({...jobs[0]!, id:"bash-2"});
    props.relations.set("s1",completeRelations([{id:"bash-1",callId:"call-1",title:"运行测试"},{id:"bash-2",callId:"call-2",title:"下载资源"}]));
    render(<Activity {...props as any}/>);
    const first=screen.getByRole("button",{name:/运行测试/});
    const second=screen.getByRole("button",{name:/下载资源/});
    fireEvent.click(first); fireEvent.click(second);
    await waitFor(()=>expect(screen.getAllByText("hello")).toHaveLength(2));
    expect(within(first.closest("li")!).getByText("hello")).toBeInTheDocument();
    expect(within(second.closest("li")!).getByText("hello")).toBeInTheDocument();
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded","false");
    expect(within(first.closest("li")!).queryByText("hello")).toBeNull();
    expect(second).toHaveAttribute("aria-expanded","true");
    expect(screen.getAllByText("hello")).toHaveLength(1);
  });
  it("moves terminal tasks out of ongoing and preserves failed/cancelled states", () => {
    const {props,jobs}=fixture(); const view=render(<Activity {...props as any}/>);
    jobs[0]!.status="failed"; view.rerender(<Activity {...props as any}/>);
    expect(within(screen.getByRole("region",{name:"进行中"})).queryByText("运行测试")).toBeNull();
    expect(screen.getByRole("button",{name:/已结束/})).toHaveAttribute("aria-expanded","false");
    fireEvent.click(screen.getByRole("button",{name:/已结束/}));
    expect(within(screen.getByRole("region",{name:"已结束"})).getByText(/失败/)).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"停止"})).toBeNull();
    jobs[0]!.status="killed"; view.rerender(<Activity {...props as any}/>);
    expect(within(screen.getByRole("region",{name:"已结束"})).getByText(/已取消/)).toBeInTheDocument();
    jobs.length=0; props.relations.set("s1",[]); view.rerender(<Activity {...props as any}/>);
    expect(screen.getByText("还没有后台任务")).toBeInTheDocument();
    expect(screen.queryByRole("region",{name:"进行中"})).toBeNull();
  });
  it("opens the ended group when navigating to a completed task", async () => {
    const {props,jobs}=fixture(); jobs[0]!.status="completed";
    render(<Activity {...props as any}/>);
    expect(screen.queryByText("运行测试")).toBeNull();
    props.relations.open("s1","bash-1");
    await waitFor(()=>expect(screen.getByRole("button",{name:/已结束/})).toHaveAttribute("aria-expanded","true"));
    await screen.findByText("hello");
    fireEvent.click(screen.getByRole("button",{name:/已结束/}));
    expect(screen.queryByText("hello")).toBeNull();
  });
  it("opens the workbench from its tab", () => {
    const {props}=fixture();
    render(<WorkbenchActivity {...props as any}/>);
    fireEvent.click(screen.getByRole("tab",{name:/后台任务/}));
    expect(props.openPanel).toHaveBeenCalledWith("background-jobs");
  });
});

it("restores collapsed history with an empty runtime registry", async () => {
  const {props,jobs}=fixture();jobs.splice(0);
  props.relations.set("s1",completeRelations([{id:"bash-1",recordId:"record-old",kind:"subagent",status:"completed",startedAt:1000,finishedAt:31000,title:"历史任务",callId:"old-call"}]));
  render(<Activity {...props as any}/>);
  expect(screen.getByRole("button",{name:/已结束/})).toHaveAttribute("aria-expanded","false");
  props.relations.open("s1","record-old");
  await screen.findByText("hello");
  expect(props.api.inspect).toHaveBeenCalledWith("s1","record-old");
});

it("leaves tool rendering and conversation progress to the host", async () => {
  const entries: Array<{name: string; key?: string; component: any}> = [];
  const effects: Array<() => void> = [];
  const unmount = vi.fn();
  const child = {
    remote: {amibaJobs: {}},
    slots: {
      inject: (_name: string, register: () => () => void) => register(),
      register: (entry: any, component: any) => {
        entries.push({...entry, component});
        return vi.fn();
      },
    },
  };
  const dispose = await apply({
    effect: (setup: () => () => void) => effects.push(setup()),
    remote: {$mount: vi.fn(async () => unmount)},
    inject: (_deps: string[], setup: (ctx: any) => () => void) => ({dispose: setup(child)}),
  } as any);
  expect(entries.some(entry => entry.name === "amiba.tool.execution")).toBe(false);
  expect(entries.some(entry => entry.name === "amiba.conversation.progress")).toBe(false);
  expect(entries.some(entry => entry.name === "amiba.workbench.panel")).toBe(true);
  for (const entry of entries.filter(entry => entry.name === "amiba.conversation.notice")) {
    const View = entry.component;
    const view = render(<View summary="后台任务已完成"/>);
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
  }
  await dispose();
  effects.forEach(cleanup => cleanup());
  expect(unmount).toHaveBeenCalledOnce();
});
