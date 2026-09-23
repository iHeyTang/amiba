import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const files=vi.hoisted(()=>({remove:vi.fn(async()=>{})}));
vi.mock("@amiba/app-runtime/platform",()=>({getPlatform:()=>({agentAttachments:files})}));
vi.mock("@amiba/i18n",()=>({useT:()=>({t:(key:string)=>key})}));
import { useComposerAttachments } from "../../useComposerAttachments";
import { deleteUnretainedAttachments, withSendingAttachments } from "../attachment-ownership";
const image=(id:string)=>({uiId:id,attachmentId:id,name:id+".png",mime:"image/png",size:3,kind:"image" as const});
beforeEach(()=>files.remove.mockClear());
it("original chip removal observes the current queue owner and releases after its last owner leaves",async()=>{
  const {result,rerender}=renderHook(({retained})=>useComposerAttachments({getSessionId:()=>"s",isAttachmentRetained:id=>retained.includes(id)}),{initialProps:{retained:["shared"]}});
  act(()=>result.current.setAttachments([image("shared")]));
  await act(async()=>{result.current.removeAttachment("shared");});
  expect(result.current.attachments).toEqual([]);
  expect(files.remove).not.toHaveBeenCalled();
  rerender({retained:[]});
  act(()=>result.current.setAttachments([image("shared")]));
  await act(async()=>{result.current.removeAttachment("shared");});
  expect(files.remove.mock.calls).toEqual([["shared"]]);
});
it("clear keeps queue-owned bytes while removing independent composer files",async()=>{
  const {result}=renderHook(()=>useComposerAttachments({getSessionId:()=>"s",isAttachmentRetained:id=>id==="shared"}));
  act(()=>result.current.setAttachments([image("shared"),image("new")]));
  await act(async()=>{result.current.clearAttachments();});
  expect(files.remove.mock.calls).toEqual([["new"]]);
  expect(result.current.attachments).toEqual([]);
});
it("transition cleanup keeps outgoing queue files and deduplicates released staging IDs",()=>{
  deleteUnretainedAttachments([image("shared"),image("new"),{...image("new"),uiId:"copy"}],[image("shared")]);
  expect(files.remove.mock.calls).toEqual([["new"]]);
});


it("queue deletion and original chip removal cannot delete bytes while a send is awaiting preparation",async()=>{
  let finish!:()=>void;
  const sending=withSendingAttachments([image("shared")],()=>new Promise<void>(resolve=>{finish=resolve;}));
  const {result}=renderHook(()=>useComposerAttachments({getSessionId:()=>"s"}));
  act(()=>result.current.setAttachments([image("shared"),image("other")]));
  await act(async()=>{result.current.removeAttachment("shared");});
  deleteUnretainedAttachments([image("shared"),image("other")],[]);
  expect(files.remove).not.toHaveBeenCalled(); // The other chip still owns its bytes.
  await act(async()=>{result.current.removeAttachment("other");});
  expect(files.remove.mock.calls).toEqual([["other"]]);
  finish();await sending;
  // Completion itself does not delete a file needed by sent history or a restored draft.
  expect(files.remove.mock.calls).toEqual([["other"]]);
  deleteUnretainedAttachments([image("shared")],[]);
  expect(files.remove.mock.calls).toEqual([["other"],["shared"]]);
});
it("overlapping sends independently retain a shared Host ID",async()=>{
  let endFirst!:()=>void,endSecond!:()=>void;
  const first=withSendingAttachments([image("shared"),image("shared")],()=>new Promise<void>(resolve=>{endFirst=resolve;}));
  const second=withSendingAttachments([image("shared")],()=>new Promise<void>(resolve=>{endSecond=resolve;}));
  endFirst();await first;
  deleteUnretainedAttachments([image("shared")],[]);
  expect(files.remove).not.toHaveBeenCalled();
  endSecond();await second;
  deleteUnretainedAttachments([image("shared")],[]);
  expect(files.remove.mock.calls).toEqual([["shared"]]);
});
it("releases temporary ownership after rejected preparation without deleting the restored draft",async()=>{
  await expect(withSendingAttachments([image("failed")],async()=>{throw new Error("prepare failed");})).rejects.toThrow("prepare failed");
  expect(files.remove).not.toHaveBeenCalled();
  deleteUnretainedAttachments([image("failed")],[]);
  expect(files.remove.mock.calls).toEqual([["failed"]]);
});

it("protects an offscreen draft from queue cleanup until its chip is removed", async () => {
  const scope = {};
  const first = renderHook(() => useComposerAttachments({ draftScope: scope, getSessionId: () => "s" }));
  act(() => first.result.current.setAttachments([image("offscreen")]));
  first.unmount();
  deleteUnretainedAttachments([image("offscreen")], []);
  expect(files.remove).not.toHaveBeenCalled();
  const restored = renderHook(() => useComposerAttachments({ draftScope: scope, getSessionId: () => "s" }));
  await act(async () => restored.result.current.removeAttachment("offscreen"));
  expect(files.remove).toHaveBeenCalledWith("offscreen");
});
