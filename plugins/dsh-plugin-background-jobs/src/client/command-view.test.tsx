import "@testing-library/jest-dom/vitest";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen,fireEvent} from "@testing-library/react";
import {CommandExecution} from "./command-view.js";
import {Activity,Notice} from "./index.js";
import {createRelations} from "./relations.js";
afterEach(cleanup);
function fixture(){
 const relations=createRelations();
 const row={id:"bash-1",recordId:"record",callId:"start",resultCallIds:["read"],title:"",command:"sleep 30; echo DONE",kind:"bash",status:"completed" as const,startedAt:1000,finishedAt:31000,updatedAt:31000};
 relations.set("s",[row]);
 const props={sessionId:"s",relations,callId:"start",toolName:"bash",block:{kind:"tool-result",callId:"start",call:{name:"bash",argsRaw:'{"command":"sleep 30; echo DONE"}'},callTime:1000,time:1024,content:[],subCalls:[],isError:false},fallback:<span>派出 24ms</span>,useSession:(fn:any)=>fn({sessionId:"s",nodes:[],runningCalls:[]}),useSessions:(fn:any)=>fn({jobsBySession:{}}),revealToolCall:vi.fn(),inspectToolCall:vi.fn(()=>true),renderMarkdown:(text:string)=><p>{text}</p>,api:{inspect:vi.fn(async()=>({ok:true,value:{sessionId:"s",id:"record",title:"",output:"DONE\n",outputAvailable:true,liveOutput:false}})),stop:vi.fn(async()=>({ok:true,value:true}))}};
 return {props,row};
}
it("restores one command with job duration and output instead of dispatch duration",async()=>{
 const {props}=fixture();render(<CommandExecution {...props as any}/>);
 expect(screen.getByText("24ms")).toBeInTheDocument();
 expect(screen.queryByText("已完成 · 30 秒")).toBeNull();
 expect(screen.queryByText("派出 24ms")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/运行命令/}));
 expect(await screen.findByText("DONE")).toBeInTheDocument();
 expect(screen.getByText("实际运行 30 秒")).toBeInTheDocument();
 expect(screen.queryByText(/查看任务/)).toBeNull();
});
it("expands result collection in place with command identity, status and output",async()=>{
 const {props}=fixture();props.block.time=1007;render(<CommandExecution {...props as any} callId="read"/>);
 fireEvent.click(screen.getByRole("button",{name:/获取执行结果/}));
 expect(await screen.findByText("DONE")).toBeInTheDocument();
 expect(screen.getByText("7ms")).toBeInTheDocument();
 expect(screen.queryByText("已完成 · 30 秒")).toBeNull();
 expect(screen.getByText("sleep 30; echo DONE")).toBeInTheDocument();
 expect(props.revealToolCall).not.toHaveBeenCalled();
});
it("keeps unrelated tools in their owning plugin renderer",()=>{
 const {props}=fixture();render(<CommandExecution {...props as any} callId="unrelated"/>);
 expect(screen.getByText("派出 24ms")).toBeInTheDocument();
});
it("makes command notifications silent and workbench rows navigate without duplicate details",()=>{
 const {props}=fixture();render(<><Notice {...props as any} summary="后台任务 · 已完成" reference={{kind:"background-job",sessionId:"s",id:"record",instance:"1000"}}/><Activity {...props as any}/></>);
 expect(screen.queryByText(/后台任务 · 已完成/)).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/已结束/}));
 fireEvent.click(screen.getByRole("button",{name:/sleep 30/}));
 expect(props.inspectToolCall).toHaveBeenCalledWith("start");
 expect(props.api.inspect).not.toHaveBeenCalled();
});
it("provides stop and live status on the original command",async()=>{
 const {props,row}=fixture();props.relations.set("s",[{...row,status:"running",startedAt:Date.now()-30000,finishedAt:undefined}]);
 render(<CommandExecution {...props as any}/>);
 fireEvent.click(screen.getByRole("button",{name:/运行命令/}));
 expect(screen.getByText("运行中")).toBeInTheDocument();
 expect(screen.getByText("24ms")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"停止"}));
 expect(props.api.stop).toHaveBeenCalledWith("s","record");
});

it("resolves original arguments by exact call ID when the record has no command",async()=>{
 const {props,row}=fixture();props.relations.set("s",[{...row,command:undefined}]);
 props.useSession=(fn:any)=>fn({sessionId:"s",runningCalls:[],nodes:[{kind:"tool-result",callId:"start",call:{name:"bash",argsRaw:JSON.stringify({command:"echo ORIGINAL"})},subCalls:[]}]});
 render(<CommandExecution {...props as any} callId="read"/>);
 fireEvent.click(screen.getByRole("button",{name:/获取执行结果.*echo ORIGINAL/}));
 expect(await screen.findByText("DONE")).toBeInTheDocument();
 expect(screen.getByText("$ echo ORIGINAL")).toBeInTheDocument();
});
it("does not invent a command when its source is outside the history window",async()=>{
 const {props,row}=fixture();props.relations.set("s",[{...row,command:undefined}]);
 render(<CommandExecution {...props as any} callId="read"/>);
 fireEvent.click(screen.getByRole("button",{name:/获取执行结果/}));
 expect(await screen.findByText("DONE")).toBeInTheDocument();
 expect(document.querySelector(".amiba-command-source")).toBeNull();
 expect(screen.queryByText("命令")).toBeNull();
});

it("removes boundary blank lines without changing output indentation or internal spacing",async()=>{
 const {props}=fixture();props.api.inspect=vi.fn(async()=>({ok:true,value:{sessionId:"s",id:"record",title:"",output:"\n\n  DONE\n\n    detail\n\n",outputAvailable:true,liveOutput:false}}));
 render(<CommandExecution {...props as any}/>);
 fireEvent.click(screen.getByRole("button",{name:/运行命令/}));
 const output=await screen.findByText(/DONE.*detail/s);
 expect(output.textContent).toBe("  DONE\n\n    detail");
});

it("supports source navigation through the shared controlled fold",async()=>{
 const {props}=fixture();const view=render(<CommandExecution {...props as any}/>);
 view.rerender(<CommandExecution {...props as any} revealVersion={1}/>);
 expect(await screen.findByText("DONE")).toBeInTheDocument();
 const row=screen.getByRole("button",{name:/运行命令/});
 expect(row).toHaveAttribute("aria-expanded","true");
 fireEvent.click(row);
 expect(row).toHaveAttribute("aria-expanded","false");
 expect(screen.queryByText("DONE")).toBeNull();
});

it("folds successful media reads into the generation task while preserving failed reads",()=>{
 const {props,row}=fixture();
 props.relations.set("s",[{...row,kind:"media"}]);
 const view=render(<CommandExecution {...props as any} toolName="job_output" callId="read"/>);
 expect(view.container).toBeEmptyDOMElement();
 view.rerender(<CommandExecution {...props as any} toolName="job_output" callId="read" block={{...props.block,isError:true}}/>);
 expect(screen.getByText("派出 24ms")).toBeInTheDocument();
});
it("labels an active media read using its exact source before the result relation exists",()=>{
 const {props,row}=fixture();
 props.relations.set("s",[{...row,kind:"media",status:"running",resultCallIds:[]}]);
 props.useSession=(fn:any)=>fn({sessionId:"s",runningCalls:[],nodes:[{kind:"tool-result",callId:"start",call:{name:"media_generate",argsRaw:'{"operation":"image.generate"}'},subCalls:[]}]});
 render(<CommandExecution {...props as any} toolName="job_output" callId="poll" presentation="summary" block={{...props.block,call:{name:"job_output",argsRaw:'{"job_id":"bash-1"}'}}}/>);
 expect(screen.getByText("等待图片生成结果")).toBeInTheDocument();
 expect(screen.queryByText("派出 24ms")).toBeNull();
});
