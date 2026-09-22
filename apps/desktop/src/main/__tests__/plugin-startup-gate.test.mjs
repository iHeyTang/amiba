import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PluginStartupGate } from '../plugin-startup-gate.ts';
async function setup(t, count, delay = 20) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amiba-gate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const marker = path.join(dir, 'startup.json');
  const gate = new PluginStartupGate(marker, async () => count, () => {}, delay);
  return { gate, marker };
}
test('no active user plugins bypasses prompt even after an old failed launch', async t => {
  const { gate, marker } = await setup(t, 0);
  await writeFile(marker, '{"pending":true}');
  await gate.wait();
  assert.equal(gate.state.phase, 'ready');
  assert.equal(gate.safe, false);
});
test('background runtime waits; countdown begins only when UI presents', async t => {
  const { gate, marker } = await setup(t, 2);
  let started = false;
  const waiting = gate.wait().then(() => { started = true; });
  await gate.initialize();
  await new Promise(r => setTimeout(r, 35));
  assert.equal(started, false);
  assert.equal(gate.state.deadline, undefined);
  await gate.present();
  await waiting;
  assert.equal(gate.state.phase, 'loading');
  assert.equal(JSON.parse(await readFile(marker, 'utf8')).pending, true);
  await gate.ready();
  assert.equal(JSON.parse(await readFile(marker, 'utf8')).pending, false);
});
test('Continue skips countdown; safe selection wins a concurrent Continue', async t => {
  const { gate } = await setup(t, 1, 5000);
  await gate.present();
  await Promise.all([gate.choose('continue'), gate.choose('safe')]);
  await gate.wait();
  assert.equal(gate.safe, true);
  assert.equal(gate.state.phase, 'safe');
});
test('interrupted loading enters safe mode without automatically retrying', async t => {
  const { gate, marker } = await setup(t, 1);
  await writeFile(marker, '{"pending":true}');
  await gate.wait();
  assert.equal(gate.safe, true);
  assert.equal(gate.state.reason, 'interrupted');
  await gate.choose('continue');
  assert.equal(gate.safe, true);
});
test('malformed inventory can still release the core in safe mode', async t => {
  const { marker } = await setup(t, 0);
  const gate = new PluginStartupGate(marker, async () => { throw new Error('bad plugin'); });
  await gate.wait();
  assert.equal(gate.safe, true);
  assert.equal(gate.state.reason, 'inspection-failed');
});
test('runtime crash after successful startup restores recovery evidence', async t => {
  const { gate, marker } = await setup(t, 1);
  await gate.initialize();
  await gate.choose('continue');
  await gate.ready();
  await gate.failed();
  assert.equal(JSON.parse(await readFile(marker, 'utf8')).pending, true);
});
