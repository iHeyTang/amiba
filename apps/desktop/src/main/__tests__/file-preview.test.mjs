import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPreviewFile, MAX_FILE_VIEW_BYTES, MAX_FILE_BINARY_BYTES } from "../file-preview.ts";
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
