import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const files=vi.hoisted(()=>({remove:vi.fn(async()=>{})}));
vi.mock("@amiba/app-runtime/platform",()=>({getPlatform:()=>({agentAttachments:files})}));
vi.mock("@amiba/i18n",()=>({useT:()=>({t:(key:string)=>key})}));
import { useComposerAttachments } from "../../useComposerAttachments";
import { deleteUnretainedAttachments } from "../attachment-ownership";
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
