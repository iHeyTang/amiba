import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { recordArtifacts as record, verifiedArtifacts, publicArtifactNames } from './artifacts.mjs';
const identity = { sourceCommit: 'a'.repeat(40), buildId: '123-1', mode: 'release', dirty: false };
const recordArtifacts = (dir, target, version, distributable = true) => record(dir, target, version, distributable, identity);
test('upload validation rejects changed, missing and stale artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-release-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'Amiba-1.0.0-win-x64.exe'), 'installer');
    fs.writeFileSync(path.join(dir, 'latest-x64.yml'), JSON.stringify({ version: '1.0.0', files: [{ url: 'Amiba-1.0.0-win-x64.exe', sha512: createHash('sha512').update('installer').digest('base64'), size: 9 }] }));
    recordArtifacts(dir, 'win32-x64', '1.0.0');
    assert.throws(() => verifiedArtifacts(dir, 'win32-x64', '1.0.0', 'b'.repeat(40)), /source commit/);
    assert.equal(verifiedArtifacts(dir, 'win32-x64', '1.0.0').length, 2);
    const metadataFile = path.join(dir, 'latest-x64.yml');
    const validMetadata = fs.readFileSync(metadataFile, 'utf8');
    const foreign = JSON.parse(validMetadata);
    foreign.files[0].url = 'Amiba-1.0.0-mac-arm64.zip';
    fs.writeFileSync(metadataFile, JSON.stringify(foreign));
    assert.throws(() => recordArtifacts(dir, 'win32-x64', '1.0.0'), /foreign artifact/);
    foreign.version = '0.9.0';
    fs.writeFileSync(metadataFile, JSON.stringify(foreign));
    assert.throws(() => recordArtifacts(dir, 'win32-x64', '1.0.0'), /version/);
    fs.writeFileSync(metadataFile, validMetadata);
    assert.throws(() => verifiedArtifacts(dir, 'win32-x64', '1.0.1'));
    recordArtifacts(dir, 'win32-x64', '1.0.0', false);
    assert.throws(() => verifiedArtifacts(dir, 'win32-x64', '1.0.0'), /Local test/);
    recordArtifacts(dir, 'win32-x64', '1.0.0');
    fs.writeFileSync(path.join(dir, 'Amiba-1.0.0-win-x64.exe'), 'corrupt');
    assert.throws(() => verifiedArtifacts(dir, 'win32-x64', '1.0.0'), /changed/);
    fs.unlinkSync(path.join(dir, 'latest-x64.yml'));
    assert.throws(() => recordArtifacts(dir, 'win32-x64', '1.0.0'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('unsigned Mac releases publish original packages without advertising automatic updates', () => {
  const files = ['Amiba-1.0.0-mac-arm64.dmg', 'Amiba-1.0.0-mac-arm64.zip', 'Amiba-1.0.0-mac-arm64.zip.blockmap', 'latest-arm64-mac.yml'];
  assert.deepEqual(publicArtifactNames({ macSigning: 'unsigned', autoUpdate: false }, files), files.slice(0, 2));
  assert.deepEqual(publicArtifactNames({ macSigning: 'signed', autoUpdate: true }, files), files);
  assert.throws(() => publicArtifactNames({ macSigning: 'unsigned', autoUpdate: true }, files), /must disable/);
});
