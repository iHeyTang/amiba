import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ComposerAttachment } from "@amiba/extension-sdk";
const files=vi.hoisted(()=>({readForPrompt:vi.fn(),remove:vi.fn(async()=>{}),put:vi.fn()}));
vi.mock("@amiba/app-runtime/platform",()=>({getPlatform:()=>({agentAttachments:files})}));
vi.mock("@amiba/i18n",()=>({useT:()=>({t:(key:string)=>key})}));
import { useComposerAttachments } from "../../useComposerAttachments";
const image=(id="host-id",uiId="native-ui")=>({uiId,attachmentId:id,name:"stored.png",mime:"image/png",size:3,kind:"image" as const});
const stored=(id="host-id")=>({attachmentId:id,name:"stored.png",mime:"image/png",kind:"image",size:3,dataBase64:"AQID"});
function registry() {
  let count=0;
  const release=vi.fn();
  const register=vi.fn((file:File)=>({image:{id:"browser-draft-"+(++count),kind:"image",file,previewUrl:"blob:restored"} as ComposerAttachment,release}));
  return {register,release};
}
beforeEach(()=>{vi.clearAllMocks();files.readForPrompt.mockReset();files.readForPrompt.mockResolvedValue(stored());});
it("restores the original bytes as a browser File, publishes a separate draft ID, and never uploads again",async()=>{
  const {register,release}=registry();
  const {result}=renderHook(()=>useComposerAttachments({getSessionId:()=>"s",registerDraftImage:register}));
  const changed=vi.fn();
  result.current.subscribeDraftImages!(changed);
  await act(async()=>{result.current.setAttachments([image()]);});
  await waitFor(()=>expect(result.current.getDraftImages!()).toHaveLength(1));
  const draft=result.current.getDraftImages!()[0];
  expect(draft.id).toBe("browser-draft-1");
  expect(draft.id).not.toBe(image().attachmentId);
  expect(draft.file.name).toBe("stored.png");
  expect(draft.file.type).toBe("image/png");
  const encoded=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(draft.file);});
  expect(encoded).toBe("data:image/png;base64,AQID");
  expect(files.readForPrompt).toHaveBeenCalledWith("host-id");
  expect(files.put).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledOnce();
  const snapshot=result.current.getDraftImages!();
  await act(async()=>{result.current.setAttachments(prev=>[...prev]);});
  expect(result.current.getDraftImages!()).toBe(snapshot);
  expect(register).toHaveBeenCalledOnce();
  await act(async()=>{result.current.setAttachments([]);});
  expect(release).toHaveBeenCalledOnce();
  expect(result.current.getDraftImages!()).toEqual([]);
});
it.each(["remove","unmount"] as const)("ignores a late file read after %s",async(action)=>{
  let finish!:(value:unknown)=>void;
  files.readForPrompt.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const {register}=registry();
  const {result,unmount}=renderHook(()=>useComposerAttachments({getSessionId:()=>"s",registerDraftImage:register}));
  act(()=>result.current.setAttachments([image()]));
  await waitFor(()=>expect(files.readForPrompt).toHaveBeenCalledOnce());
  act(()=>{if(action==="remove")result.current.setAttachments([]);else unmount();});
  await act(async()=>{finish(stored());});
  expect(register).not.toHaveBeenCalled();
});
it("discarded provider and replaced Host ID cannot publish a stale registration",async()=>{
  const pending: Array<{id:string;finish:(value:unknown)=>void}>=[];
  files.readForPrompt.mockImplementation((id:string)=>new Promise(resolve=>pending.push({id,finish:resolve})));
  const first=registry(),second=registry();
  const {result,rerender}=renderHook(({register})=>useComposerAttachments({getSessionId:()=>"s",registerDraftImage:register}),{initialProps:{register:first.register}});
  act(()=>result.current.setAttachments([image()]));
  rerender({register:second.register});
  act(()=>result.current.setAttachments([image("new-host")]));
  await act(async()=>{for(const item of pending) item.finish(stored(item.id));});
  expect(first.register).not.toHaveBeenCalled();
  expect(second.register).toHaveBeenCalledOnce();
  expect(result.current.getDraftImages!()).toHaveLength(1);
});
it("keeps native attachments available if stored identity is invalid, without retrying on every render",async()=>{
  const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
  files.readForPrompt.mockResolvedValue(stored("different-host"));
  const {register}=registry();
  const {result}=renderHook(()=>useComposerAttachments({getSessionId:()=>"s",registerDraftImage:register}));
  await act(async()=>{result.current.setAttachments([image()]);});
  expect(register).not.toHaveBeenCalled();
  expect(result.current.attachments).toEqual([image()]);
  await act(async()=>{result.current.setAttachments(prev=>[...prev]);});
  expect(files.readForPrompt).toHaveBeenCalledOnce();
  warning.mockRestore();
});


it("replaces a published image when the same native row points at different Host bytes",async()=>{
  files.readForPrompt.mockImplementation(async(id:string)=>stored(id));
  const {register,release}=registry();
  const {result}=renderHook(()=>useComposerAttachments({getSessionId:()=>"s",registerDraftImage:register}));
  await act(async()=>{result.current.setAttachments([image()]);});
  expect(result.current.getDraftImages!()[0].id).toBe("browser-draft-1");
  await act(async()=>{result.current.setAttachments([image("replacement")]);});
  expect(release).toHaveBeenCalledOnce();
  expect(result.current.getDraftImages!()[0].id).toBe("browser-draft-2");
  expect(files.readForPrompt).toHaveBeenLastCalledWith("replacement");
});
