import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
export async function smokeDocumentRead({ evaluate, fileWorkspace }) {
  const file = path.join(fileWorkspace, 'compat-document.txt');
  const outside = await mkdtemp(path.join(tmpdir(), 'amiba-document-outside-'));
  const link = path.join(fileWorkspace, 'compat-document-escape');
  const read = (candidate, request) => evaluate(`window.amiba.files.readDocument(window.__compatSessionId,${JSON.stringify(candidate)},${JSON.stringify(request)}).result`);
  try {
    await writeFile(file, '你好\nsecond\n');
    const first = await read(file, { kind: 'text', limit: 1 });
    assert.equal(first.ok, true); assert.equal(first.value.text, '你好'); assert.equal(first.value.eof, false);
    assert.equal(first.value.version, (await evaluate(`window.amiba.files.stat(window.__compatSessionId,${JSON.stringify(file)})`)).version);
    const last = await read(file, { kind: 'text', offset: 2, limit: 1 });
    assert.equal(last.value.text, 'second'); assert.equal(last.value.eof, true);
    const bytes = await read(file, { kind: 'bytes', offset: 0, length: 6 });
    assert.equal(Buffer.from(bytes.value.data, 'base64').toString(), '你好');
    assert.equal(Buffer.from((await read(file, { kind: 'all' })).value.data, 'base64').toString(), '你好\nsecond\n');
    assert.equal((await read(file, { kind: 'text', offset: 0 })).error.code, 'gateway/bad-request');
    assert.equal((await read(file + '-missing', { kind: 'all' })).error.code, 'workspace-file/not-found');
    await writeFile(path.join(outside, 'secret'), 'OUTSIDE_FIXTURE');
    await symlink(outside, link, 'dir');
    const related = await read(file, { kind: 'all', relativePath: './compat-document.txt' });
    assert.equal(Buffer.from(related.value.data, 'base64').toString(), '你好\nsecond\n');
    assert.equal((await read(file + '-missing', { kind: 'all', relativePath: './compat-document.txt' })).error.code, 'workspace-file/not-found');
    assert.equal((await read(file, { kind: 'all', relativePath: 'compat-document-escape/secret' })).error.code, 'workspace-file/outside-workspace');
    assert.equal((await read(file, { kind: 'all', relativePath: path.relative(fileWorkspace, path.join(outside, 'secret')) })).error.code, 'workspace-file/outside-workspace');
    assert.equal((await read(file, { kind: 'all', relativePath: '/absolute.js' })).error.code, 'gateway/bad-request');
    for (const candidate of [path.join(outside, 'secret'), path.join(link, 'secret')]) assert.equal((await read(candidate, { kind: 'all' })).error.code, 'workspace-file/outside-workspace');
    await writeFile(file, Buffer.from([0, 255]));
    assert.equal((await read(file, { kind: 'text' })).error.code, 'workspace-file/not-text');
    await truncate(file, 32 * 1024 * 1024 + 1);
    const oversized = await read(file, { kind: 'all' });
    assert.equal(oversized.error.code, 'workspace-file/too-large'); assert.equal(oversized.error.details.limit, 32 * 1024 * 1024);
    await writeFile(file, 'line\n'.repeat(2_000_000));
    const cancelled = await evaluate(`(()=>{const pending=window.amiba.files.readDocument(window.__compatSessionId,${JSON.stringify(file)},{kind:'text',offset:Number.MAX_SAFE_INTEGER});pending.dispose();pending.dispose();return pending.result})()`);
    assert.equal(cancelled.error.code, 'ABORT_ERR');
  } finally { await rm(link, { force: true }); await rm(file, { force: true }); await rm(outside, { recursive: true, force: true }); }
  console.log('Document reads crossed real preload/IPC with line paging, byte windows, full reads, canonical version, typed errors, workspace/symlink denial and cancellation.');
}
