import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { recordArtifacts, verifiedArtifacts } from './artifacts.mjs';
test('upload validation rejects changed, missing and stale artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-release-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'Amiba-1.0.0-win-x64.exe'), 'installer');
    fs.writeFileSync(path.join(dir, 'latest-x64.yml'), JSON.stringify({ version: '1.0.0', files: [{ url: 'Amiba-1.0.0-win-x64.exe', sha512: createHash('sha512').update('installer').digest('base64'), size: 9 }] }));
    recordArtifacts(dir, 'win32-x64', '1.0.0');
    assert.equal(verifiedArtifacts(dir, 'win32-x64', '1.0.0').length, 2);
    assert.throws(() => verifiedArtifacts(dir, 'win32-x64', '1.0.1'));
    fs.writeFileSync(path.join(dir, 'Amiba-1.0.0-win-x64.exe'), 'corrupt');
    assert.throws(() => verifiedArtifacts(dir, 'win32-x64', '1.0.0'), /changed/);
    fs.unlinkSync(path.join(dir, 'latest-x64.yml'));
    assert.throws(() => recordArtifacts(dir, 'win32-x64', '1.0.0'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
