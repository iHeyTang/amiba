import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDocumentFile } from '../document-file-reader.ts';
import { statWorkspaceFile } from '../file-preview.ts';
async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'amiba-document-'));
  try { await run(join(dir, 'document'), dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const limits = { maxBytes: 16, maxFileBytes: 32, maxLines: 3 };
test('line windows distinguish empty files, empty lines, final LF and pages past EOF', async () => fixture(async path => {
  for (const [content, expected] of [ ['', ['', 0]], ['\n', ['', 1]], ['a\n', ['a', 1]], ['a\n\n', ['a\n', 2]], ['a\r\nb', ['a\r\nb', 2]] ]) {
    await writeFile(path, content);
    const page = await readDocumentFile({ path }, { kind: 'text' });
    assert.deepEqual([page.text, page.lines, page.eof], [...expected, true]);
    const beyond = await readDocumentFile({ path }, { kind: 'text', offset: 9 });
    assert.deepEqual([beyond.offset, beyond.text, beyond.lines, beyond.eof], [9, '', 0, true]);
  }
  await writeFile(path, 'one\ntwo\nthree\n');
  const first = await readDocumentFile({ path }, { kind: 'text', limit: 2 });
  assert.deepEqual([first.text, first.lines, first.eof], ['one\ntwo', 2, false]);
  const last = await readDocumentFile({ path }, { kind: 'text', offset: 3, limit: 1 });
  assert.deepEqual([last.text, last.lines, last.eof], ['three', 1, true]);
  assert.equal(first.version, (await statWorkspaceFile({ path })).version);
}));
test('text paging streams beyond file caps, handles split UTF-8, and never silently truncates a page', async () => fixture(async path => {
  await writeFile(path, 'x'.repeat(65535) + '你\nend');
  const page = await readDocumentFile({ path }, { kind: 'text', offset: 2 }, undefined, limits);
  assert.deepEqual([page.text, page.lines, page.eof], ['end', 1, true]);
  await assert.rejects(readDocumentFile({ path }, { kind: 'text' }, undefined, limits), { code: 'workspace-file/too-large', details: { path, limit: 16 } });
  await writeFile(path, 'x'.repeat(65535) + '你\n');
  assert.equal((await readDocumentFile({ path }, { kind: 'text' })).text, 'x'.repeat(65535) + '你');
  await writeFile(path, '1234567890123456\n');
  assert.equal((await readDocumentFile({ path }, { kind: 'text' }, undefined, limits)).text.length, 16);
}));
test('strict text decoding rejects binary, malformed UTF-8 and truncated codepoints', async () => fixture(async path => {
  for (const bytes of [Buffer.from([0]), Buffer.from([255]), Buffer.from([0xe4, 0xbd]), Buffer.from('a'.repeat(9000) + '\0')]) {
    await writeFile(path, bytes);
    await assert.rejects(readDocumentFile({ path }, { kind: 'text' }), { code: 'workspace-file/not-text' });
    assert.deepEqual(Buffer.from((await readDocumentFile({ path }, { kind: 'all' })).data, 'base64'), bytes);
  }
}));
test('raw windows and complete reads preserve binary bytes and enforce distinct caps', async () => fixture(async path => {
  const bytes = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
  await writeFile(path, bytes);
  const all = await readDocumentFile({ path }, { kind: 'all' }, undefined, limits);
  assert.deepEqual(Buffer.from(all.data, 'base64'), bytes); assert.equal(all.eof, true); assert.equal(all.offset, 0);
  const page = await readDocumentFile({ path }, { kind: 'bytes', offset: 20, length: 16 }, undefined, limits);
  assert.deepEqual(Buffer.from(page.data, 'base64'), bytes.subarray(20)); assert.equal(page.eof, true);
  assert.equal((await readDocumentFile({ path }, { kind: 'bytes', offset: 100 }, undefined, limits)).data, '');
  await assert.rejects(readDocumentFile({ path }, { kind: 'bytes', length: 17 }, undefined, limits), { code: 'workspace-file/too-large' });
  await writeFile(path, Buffer.alloc(33));
  await assert.rejects(readDocumentFile({ path }, { kind: 'all' }, undefined, limits), { code: 'workspace-file/too-large' });
}));
test('invalid ranges, unavailable files and cancellation fail explicitly', async () => fixture(async (path, dir) => {
  await writeFile(path, 'text');
  for (const request of [{ kind: 'text', offset: 0 }, { kind: 'text', limit: 4 }, { kind: 'bytes', offset: -1 }, { kind: 'bytes', length: NaN }, { kind: 'bytes', offset: Number.MAX_SAFE_INTEGER }]) {
    await assert.rejects(readDocumentFile({ path }, request, undefined, limits), { code: 'gateway/bad-request' });
  }
  await assert.rejects(readDocumentFile({ path: dir }, { kind: 'all' }), { code: 'workspace-file/not-regular-file' });
  await assert.rejects(readDocumentFile({ path: path + '-missing' }, { kind: 'all' }), { code: 'workspace-file/not-found' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readDocumentFile({ path }, { kind: 'text' }, controller.signal), { name: 'AbortError' });
  const during = new AbortController();
  const reading = readDocumentFile({ path }, { kind: 'all' }, during.signal);
  during.abort();
  await assert.rejects(reading, { name: 'AbortError' });
}));
