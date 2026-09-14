import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AmibaAttachmentStore, readManagedPdf, readManagedText } from "./index.js";

function simplePdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function base64(data: Uint8Array | string): string {
  return Buffer.from(data).toString("base64");
}

describe("Amiba DSH attachment store", () => {
  it("reads bounded UTF-8 chunks by opaque id", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-attachments-"));
    const store = new AmibaAttachmentStore(root);
    const record = await store.put({
      name: "../../note.txt",
      mime: "text/plain",
      kind: "text",
      dataBase64: base64("hello world"),
    });

    expect(record.name).toBe("note.txt");
    await expect(
      readManagedText(store, {
        attachmentId: record.attachmentId,
        offset: 6,
        maxChars: 3,
      }),
    ).resolves.toEqual({
      attachmentId: record.attachmentId,
      text: "wor",
      offset: 6,
      nextOffset: 9,
      totalChars: 11,
    });
  });

  it("rejects path-shaped ids, wrong kinds, and symlinked objects", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-attachments-"));
    const store = new AmibaAttachmentStore(root);
    await expect(store.read("/Users/example/secret.txt")).rejects.toThrow(
      /attachment id/iu,
    );

    const record = await store.put({
      name: "binary.pdf",
      mime: "application/pdf",
      kind: "pdf",
      dataBase64: base64(new Uint8Array([0xff, 0xfe, 0x00])),
    });
    await expect(
      readManagedText(store, { attachmentId: record.attachmentId }),
    ).rejects.toThrow(/UTF-8 text/u);

    const objectPath = join(root, "v1", "objects", `${record.attachmentId}.bin`);
    const outside = join(root, "outside.bin");
    await writeFile(outside, "outside");
    await writeFile(objectPath, "placeholder");
    await import("node:fs/promises").then(({ unlink }) => unlink(objectPath));
    await symlink(outside, objectPath);
    await expect(store.read(record.attachmentId)).rejects.toThrow(/invalid/u);
  });

  it("extracts bounded PDF text without an external executable", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-attachments-"));
    await mkdir(root, { recursive: true });
    const store = new AmibaAttachmentStore(root);
    const record = await store.put({
      name: "sample.pdf",
      mime: "application/pdf",
      kind: "pdf",
      dataBase64: base64(simplePdf("Hello from Amiba PDF")),
    });

    const result = await readManagedPdf(store, {
      attachmentId: record.attachmentId,
    });
    expect(result.totalPages).toBe(1);
    expect(result.pages).toEqual([
      { page: 1, text: expect.stringContaining("Hello from Amiba PDF") },
    ]);
    expect(result.truncated).toBe(false);
  });
});

it("persists session references across store recreation and rejects ordinary draft deletion", async()=>{
  const root=await mkdtemp(join(tmpdir(),"amiba-attachment-retention-"));
  const store=new AmibaAttachmentStore(root);
  const item=await store.put({name:"saved.txt",mime:"text/plain",kind:"text",dataBase64:base64("retained bytes")});
  await Promise.all([store.retainForSession(item.attachmentId,"session-a"),store.retainForSession(item.attachmentId,"session-b"),store.retainForSession(item.attachmentId,"session-a")]);
  const restored=new AmibaAttachmentStore(root);
  expect((await restored.read(item.attachmentId)).retainedBy).toEqual(["session-a","session-b"]);
  expect(await restored.remove(item.attachmentId)).toEqual({attachmentId:item.attachmentId,deleted:false});
  expect(Buffer.from((await restored.read(item.attachmentId)).data).toString()).toBe("retained bytes");
});
it("serializes retain-before-remove while leaving unreferenced drafts removable",async()=>{
  const root=await mkdtemp(join(tmpdir(),"amiba-attachment-race-"));
  const store=new AmibaAttachmentStore(root);
  const item=await store.put({name:"a.txt",mime:"text/plain",kind:"text",dataBase64:base64("bytes")});
  const retaining=store.retainForSession(item.attachmentId,"session");
  const removing=store.remove(item.attachmentId);
  await retaining;
  expect((await removing).deleted).toBe(false);
  const draft=await store.put({name:"draft.txt",mime:"text/plain",kind:"text",dataBase64:base64("draft")});
  expect((await store.remove(draft.attachmentId)).deleted).toBe(true);
  await expect(store.retainForSession(draft.attachmentId,"session")).rejects.toThrow();
});
