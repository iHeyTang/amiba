import { WorkspaceTextMentionsContext } from "@amiba/ui";
// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TurnTail, TurnText, matchingInterruptedStep, turnTailOwner, useTurnTailAnchors } from "./turn-tail";
afterEach(cleanup);
function fixture(closing: number | null = 12) {
  const data = {
    seq: 15,
    closing: closing === null ? null : { finalNode: { seq: closing } },
  };
  const turn = { turn: 7, status: "closed", data: { get: () => data } };
  const snapshot = {
    chat: { timeline: { turns: new Map([[7, turn]]) } },
  } as any;
  return { turn, snapshot };
}
it("forwards exact engine TurnLocation and closing anchor with the caller's opener", () => {
  const f = fixture(),
    openFile = vi.fn();
  const owner = turnTailOwner(f.snapshot, 7, openFile)!;
  expect(owner.turn).toBe(f.turn);
  expect(owner.seq).toBe(12);
  owner.openFile("relative/report.html");
  expect(openFile).toHaveBeenCalledWith("relative/report.html");
  expect(turnTailOwner(fixture(null).snapshot, 7, openFile)?.seq).toBe(15);
});
it("renders nothing for missing or open turns", () => {
  const f = fixture(),
    renderer = vi.fn(() => "tail");
  expect(turnTailOwner(f.snapshot, 1, vi.fn())).toBeNull();
  f.turn.status = "open";
  expect(turnTailOwner(f.snapshot, 7, vi.fn())).toBeNull();
  const { container } = render(
    <TurnTail runtimeTurn={7} openFile={vi.fn()} render={renderer} />,
  );
  expect(container.innerHTML).toBe("");
  expect(renderer).not.toHaveBeenCalled();
});
it("binds session methods and cleans up the old subscription on session changes", () => {
  const f = fixture(),
    listeners = new Set<() => void>();
  const source = {
    snapshot: f.snapshot,
    getSnapshot() {
      return this.snapshot;
    },
    subscribe(fn: () => void) {
      expect(this).toBe(source);
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const { container, rerender, unmount } = render(
    <TurnTail
      source={source}
      runtimeTurn={7}
      openFile={vi.fn()}
      render={(owner) => `tail:${owner.seq}`}
    />,
  );
  expect(container.textContent).toBe("tail:12");
  expect(listeners.size).toBe(1);
  act(() => {
    source.snapshot = fixture(null).snapshot;
    for (const fn of listeners) fn();
  });
  expect(container.textContent).toBe("tail:15");
  rerender(
    <TurnTail
      runtimeTurn={7}
      openFile={vi.fn()}
      render={() => "wrong session"}
    />,
  );
  expect(listeners.size).toBe(0);
  expect(container.innerHTML).toBe("");
  unmount();
});


it("publishes only real closed turn endpoints and drops anchors on session change", () => {
  const turn = {status:"open",end:null as any,data:{get:()=>({})}};
  let snapshot:any={chat:{timeline:{turnOrder:[7],turns:new Map([[7,turn]])}}};
  const listeners=new Set<()=>void>();
  const source={getSnapshot(){return snapshot;},subscribe(fn:()=>void){listeners.add(fn);return ()=>{listeners.delete(fn);};}};
  const {result,rerender}=renderHook(({current})=>useTurnTailAnchors(current),{initialProps:{current:source as any}});
  expect(result.current).toEqual([]);
  act(()=>{
    snapshot={chat:{timeline:{turnOrder:[7],turns:new Map([[7,{...turn,status:"closed",end:{seq:91}}]])}}};
    for(const fn of listeners)fn();
  });
  expect(result.current).toEqual([{runtimeTurn:7,endSeq:91}]);
  rerender({current:undefined});
  expect(result.current).toEqual([]);
  expect(listeners.size).toBe(0);
});


it("reports rejected open requests and ignores outcomes after the session changes", async () => {
  let owner:any;
  let reject!: (error:Error)=>void;
  const source={getSnapshot:()=>fixture().snapshot,subscribe:()=>()=>{}};
  const snapshot=fixture().snapshot;
  source.getSnapshot=()=>snapshot;
  const openFile=vi.fn(()=>new Promise<void>((_resolve,fail)=>{reject=fail;}));
  const {container,rerender}=render(<TurnTail source={source} runtimeTurn={7} openFile={openFile} render={value=>{owner=value;return "tail";}}/>);
  await act(async()=>{owner.openFile(".");});
  await act(async()=>{reject(new Error("directory unavailable"));});
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("directory unavailable");
  await act(async()=>{owner.openFile(".");});
  rerender(<TurnTail runtimeTurn={8} openFile={openFile} render={()=>"wrong"}/>);
  await act(async()=>{reject(new Error("old request"));});
  expect(container.innerHTML).toBe("");
});


it("resolves prose only for the closing sequence and drops the resolver without a source", () => {
  const f=fixture(),open=vi.fn();
  let resolve:React.ContextType<typeof WorkspaceTextMentionsContext>;
  function Consumer(){resolve=React.useContext(WorkspaceTextMentionsContext);return "native prose";}
  const provider=vi.fn((owner:any)=>({resolve:(value:string)=>({label:"Open "+value,title:value,open:()=>owner.openFile(value)})}));
  const source={getSnapshot:()=>f.snapshot,subscribe:()=>()=>{}};
  const {rerender}=render(<TurnText source={source} runtimeTurn={7} openFile={open} fileMentions={provider}><Consumer/></TurnText>);
  expect(resolve?.(11,"same.txt")).toBeUndefined();
  resolve?.(12,"same.txt")?.open();
  expect(open).toHaveBeenCalledWith("same.txt");
  expect(provider.mock.calls[0][0].turn).toBe(f.turn);
  rerender(<TurnText runtimeTurn={7} openFile={open} fileMentions={provider}><Consumer/></TurnText>);
  expect(resolve?.(12,"same.txt")).toBeUndefined();
});

it("verifies complete pending step text against the actual synthetic final before resolving", () => {
  const final:any={seq:14.1,step:2,interrupted:true,blocks:[{kind:"text",text:"First `file.txt`"},{kind:"reasoning",text:"private.txt"},{kind:"text",text:"Last `file.txt`"}]};
  const data={seq:15,closing:{finalNode:final}};
  const turn:any={turn:7,status:"closed",data:{get:()=>data}};
  const snapshot:any={chat:{timeline:{turns:new Map([[7,turn]])}}};
  const timeline:any[]=[
    {kind:"text",id:"a",text:"discarded First `file.txt`",sourceRanges:[{start:10,end:26,runtimeStep:2}]},
    {kind:"reasoning",id:"thought",text:"private.txt"},
    {kind:"text",id:"b",text:"Last `file.txt`",sourceRanges:[{start:0,end:15,runtimeStep:2}]},
  ];
  const owner=turnTailOwner(snapshot,7,vi.fn())!;
  expect(matchingInterruptedStep(owner,timeline)).toBe(2);
  expect(matchingInterruptedStep(owner,timeline.slice(0,1))).toBeUndefined();
  const provider=vi.fn((_owner:any)=>({resolve:(value:string)=>({label:value,title:value,open:vi.fn()})}));
  let resolve:React.ContextType<typeof WorkspaceTextMentionsContext>;
  function Consumer(){resolve=React.useContext(WorkspaceTextMentionsContext);return "unchanged";}
  const source={getSnapshot:()=>snapshot,subscribe:()=>()=>{}};
  const {rerender}=render(<TurnText source={source} runtimeTurn={7} timeline={timeline} openFile={vi.fn()} fileMentions={provider}><Consumer/></TurnText>);
  expect(resolve?.(undefined,"file.txt",2)?.title).toBe("file.txt");
  expect(resolve?.(undefined,"file.txt",1)).toBeUndefined();
  expect(resolve?.(undefined,"file.txt")).toBeUndefined();
  expect(resolve?.(12,"file.txt",2)).toBeUndefined();
  expect(provider.mock.calls[0][0].seq).toBe(final.seq);
  final.blocks[0].text="corrected.txt";
  rerender(<TurnText source={source} runtimeTurn={7} timeline={timeline} openFile={vi.fn()} fileMentions={provider}><Consumer/></TurnText>);
  expect(resolve?.(undefined,"file.txt",2)).toBeUndefined();
  final.blocks[0].text="First `file.txt`";
  final.messageId="actual-message";
  expect(matchingInterruptedStep(owner,timeline)).toBeUndefined();
  delete final.messageId;
  timeline[0].sourceRanges=[];
  expect(matchingInterruptedStep(owner,timeline)).toBeUndefined();
});
