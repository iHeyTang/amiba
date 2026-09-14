import assert from "node:assert/strict";
import { mkdtemp, writeFile, truncate, symlink, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function smokeFileStat({ evaluate, fileWorkspace, openedFile }) {
  const stat = candidate => evaluate(`window.amiba.files.stat(window.__compatSessionId, ${JSON.stringify(candidate)})`);
  const first = await stat(openedFile);
  assert.equal(first.absolutePath, await realpath(openedFile));
  assert.equal(first.bytes, Buffer.byteLength("COMPAT_FILE_OPENED"));
  assert.equal(typeof first.version, "string");
  assert.deepEqual(await stat("compat-open.txt"), first);
  const bigFile = path.join(fileWorkspace, "compat-stat-large.bin");
  const outside = await mkdtemp(path.join(tmpdir(), "amiba-stat-outside-"));
  const link = path.join(fileWorkspace, "compat-stat-escape");
  try {
    await writeFile(bigFile, Buffer.from([0, 255]));
    await truncate(bigFile, 32 * 1024 * 1024 + 1);
    assert.equal((await stat(bigFile)).bytes, 32 * 1024 * 1024 + 1);
    await writeFile(path.join(outside, "secret.txt"), "OUTSIDE_FIXTURE");
    await symlink(outside, link, "dir");
    for (const candidate of [path.join(outside, "secret.txt"), path.relative(fileWorkspace, path.join(outside, "secret.txt")), path.join(link, "secret.txt")]) {
      const error = await evaluate(`window.amiba.files.stat(window.__compatSessionId, ${JSON.stringify(candidate)}).then(()=>null,e=>String(e))`);
      assert.match(error ?? "", /outside this conversation's workspace/);
    }
    const directoryError = await evaluate(`window.amiba.files.stat(window.__compatSessionId, ${JSON.stringify(fileWorkspace)}).then(()=>null,e=>String(e))`);
    assert.match(directoryError ?? "", /not a file/);
  } finally {
    await rm(link, { force: true });
    await rm(bigFile, { force: true });
    await rm(outside, { recursive: true, force: true });
  }
  console.log("File metadata crossed real IPC; full size, canonical identity and workspace escape rejection verified.");
}
