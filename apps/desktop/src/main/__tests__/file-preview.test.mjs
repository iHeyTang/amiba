import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, truncate, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statWorkspaceFile, readPreviewFile, MAX_FILE_VIEW_BYTES, MAX_FILE_BINARY_BYTES } from "../file-preview.ts";
test("binary bytes round-trip intact and text stays bounded", async()=>{
 const dir=await mkdtemp(join(tmpdir(),"amiba-preview-"));
 try {
  const path=join(dir,"code.PNG"), bytes=Buffer.from([137,80,78,71,13,10,26,10,0,1,255]);
  await writeFile(path,bytes);
  const doc=await readPreviewFile({path,relativePath:"code.PNG"});
  assert.equal(doc.binary,true);assert.equal(doc.mimeType,"image/png");assert.equal(doc.content,"");
  const raw=await readPreviewFile({path,relativePath:"code.PNG"},true);
  assert.deepEqual(Buffer.from(raw.base64,"base64"),bytes);
  const text=join(dir,"large.txt");await writeFile(text,"x".repeat(MAX_FILE_VIEW_BYTES+1));
  const preview=await readPreviewFile({path:text,relativePath:"large.txt"});
  assert.equal(preview.truncated,true);assert.equal(preview.content.length,MAX_FILE_VIEW_BYTES);
  await truncate(path,MAX_FILE_BINARY_BYTES+1);
  await assert.rejects(readPreviewFile({path,relativePath:"code.PNG"},true),/32 MB/);
  await assert.rejects(readPreviewFile({path:dir,relativePath:"."}),/not a file/);
 } finally { await rm(dir,{recursive:true,force:true}); }
});

test("metadata handles files beyond preview limits and tracks replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "amiba-file-stat-"));
  try {
    const path = join(dir, "large.bin");
    await writeFile(path, Buffer.from([0, 255]));
    await truncate(path, MAX_FILE_BINARY_BYTES + 1);
    const first = await statWorkspaceFile({ path });
    assert.equal(first.absolutePath, path);
    assert.equal(first.bytes, MAX_FILE_BINARY_BYTES + 1);
    assert.equal(typeof first.version, "string");
    assert.deepEqual(await statWorkspaceFile({ path }), first);
    assert.equal("content" in first, false);
    assert.equal("base64" in first, false);
    await assert.rejects(readPreviewFile({ path, relativePath: "large.bin" }, true), /32 MB/);
    const replacement = join(dir, "replacement.bin");
    await writeFile(replacement, "new");
    await truncate(replacement, first.bytes);
    await rename(replacement, path);
    const second = await statWorkspaceFile({ path });
    assert.equal(second.bytes, first.bytes);
    assert.notEqual(second.version, first.version);
    await assert.rejects(statWorkspaceFile({ path: dir }), /not a file/);
    await rm(path);
    await assert.rejects(statWorkspaceFile({ path }), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
