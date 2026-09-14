import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "@amiba/app-runtime/core";
const read = vi.hoisted(() => vi.fn());
vi.mock("@amiba/app-runtime/platform", () => ({ getPlatform: () => ({ agentAttachments: { readForPrompt: read } }) }));
import { commandImages } from "../command-attachments";
const claim = { token: "/image ", images: true, submit: vi.fn() };
const attachment: Attachment = { uiId: "ui", attachmentId: "stored", name: "original.png", mime: "image/png", size: 3, kind: "image", thumbDataUrl: "thumbnail" };
beforeEach(() => {
  read.mockReset().mockResolvedValue({ attachmentId: "stored", name: "original.png", mime: "image/png", size: 3, kind: "image", dataBase64: "AQID" });
});
describe("command image serialization", () => {
  it("reads original staged bytes and preserves their name and media type", async () => {
    expect(await commandImages(claim, [attachment])).toEqual([{ mediaType: "image/png", name: "original.png", data: "AQID" }]);
    expect(read).toHaveBeenCalledWith("stored");
  });
  it("refuses unsupported commands before reading bytes", async () => {
    await expect(commandImages({ ...claim, images: false }, [attachment])).rejects.toThrow("does not accept images");
    expect(read).not.toHaveBeenCalled();
  });
  it("accepts the newer attachment capability while preserving original image validation", async () => {
    const modern = { name: "image", token: "/image ", attachments: true, submit: vi.fn() };
    expect(await commandImages(modern, [attachment])).toEqual([{ mediaType: "image/png", name: "original.png", data: "AQID" }]);
    read.mockClear();
    await expect(commandImages(modern, [{ ...attachment, kind: "pdf" }])).rejects.toThrow("not available in this runtime yet");
    expect(read).not.toHaveBeenCalled();
    const refusing = { ...modern, attachments: false, images: true };
    await expect(commandImages(refusing, [attachment])).rejects.toThrow("does not accept images");
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps incomplete uploads and non-image files out of command submission", async () => {
    await expect(commandImages(claim, [{ ...attachment, uploading: true }])).rejects.toThrow("finish uploading");
    await expect(commandImages(claim, [{ ...attachment, kind: "pdf" }])).rejects.toThrow("image attachments only");
    expect(read).not.toHaveBeenCalled();
  });
  it.each([{ attachmentId: "other" }, { size: 4 }, { kind: "text" }, { mime: "image/svg+xml" }])("rejects mismatched stored data %j", async (patch) => {
    read.mockResolvedValue({ attachmentId: "stored", name: "original.png", mime: "image/png", size: 3, kind: "image", dataBase64: "AQID", ...patch });
    await expect(commandImages(claim, [attachment])).rejects.toThrow("failed image validation");
  });
  it("propagates staging read failure without yielding partial images", async () => {
    read.mockRejectedValue(new Error("file unavailable"));
    await expect(commandImages(claim, [attachment])).rejects.toThrow("file unavailable");
  });
});

it('uploads validated native files and preserves their position among images', async () => {
  const file:Attachment={uiId:'file-ui',attachmentId:'file-id',name:'note.txt',mime:'text/plain',size:3,kind:'text'};
  read.mockImplementation(async id=>id==='file-id'?{attachmentId:id,name:'note.txt',mime:'text/plain',size:3,kind:'text',dataBase64:'YWJj'}:{attachmentId:'stored',name:'original.png',mime:'image/png',size:3,kind:'image',dataBase64:'AQID'});
  const modern={token:'/file ',attachments:true,submit:vi.fn()};
  const upload=vi.fn(async()=> 'official-receipt');
  expect(await commandImages(modern,[file,attachment],upload)).toEqual([{type:'file',receiptId:'official-receipt'},{mediaType:'image/png',data:'AQID',name:'original.png'}]);
  expect(upload).toHaveBeenCalledWith('YWJj','note.txt');
});
it('validates the entire native batch before issuing file upload requests', async () => {
  const file:Attachment={uiId:'file-ui',attachmentId:'file-id',name:'note.txt',mime:'text/plain',size:3,kind:'text'};
  read.mockImplementation(async id=>id==='file-id'?{attachmentId:id,name:'note.txt',mime:'text/plain',size:3,kind:'text',dataBase64:'YWJj'}:{attachmentId:'stored',name:'bad.svg',mime:'image/svg+xml',size:3,kind:'image',dataBase64:'AQID'});
  const modern={token:'/file ',attachments:true,submit:vi.fn()};
  const upload=vi.fn(async()=> 'receipt');
  await expect(commandImages(modern,[file,attachment],upload)).rejects.toThrow('validation');
  expect(upload).not.toHaveBeenCalled();
});
