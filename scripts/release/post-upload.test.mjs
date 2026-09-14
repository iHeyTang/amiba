import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { postArtifact } from './post-upload.mjs';
test('POST adapter sends file and release identity, rejects HTTP failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-upload-'));
  try {
    const file = path.join(dir, 'package.zip');
    fs.writeFileSync(file, 'package data');
    const input = { endpoint: 'https://uploads.example/api', token: 'test-token', file, name: 'package.zip', version: '1.0.0', target: 'darwin-arm64', sha512: 'digest', kind: 'artifact' };
    await postArtifact(input, async (url, options) => {
      assert.equal(url.href, input.endpoint);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.equal(await options.body.get('file').text(), 'package data');
      assert.equal(options.body.get('target'), 'darwin-arm64');
      assert.equal(options.body.get('sha512'), 'digest');
      return new Response(null, { status: 201 });
    });
    await assert.rejects(postArtifact(input, async () => new Response(null, { status: 500 })), /HTTP 500/);
    await assert.rejects(postArtifact({ ...input, endpoint: 'http://uploads.example' }), /HTTPS/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
