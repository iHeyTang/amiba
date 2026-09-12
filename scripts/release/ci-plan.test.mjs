import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciPlan } from './ci-plan.mjs';
test('CI uses a native runner for each architecture and defaults to test builds', () => {
  const plan = ciPlan({ version: '0.1.0' });
  assert.equal(plan.matrix.include.length, 3);
  assert.equal(plan.mode, 'test');
  assert.equal(plan.publish, false);
  assert.equal(plan.matrix.include.find(row => row.target === 'win32-x64').runner, 'windows-2022');
});
test('CI validates release tags and prevents publishing disabled test updates', () => {
  assert.throws(() => ciPlan({ ref: 'refs/tags/v1.0.0', version: '0.1.0' }));
  assert.throws(() => ciPlan({ version: '0.1.0', inputs: { publish_draft: 'true' } }));
  const plan = ciPlan({ version: '0.1.0', inputs: { target: 'win32-x64', mode: 'release', publish_draft: 'true' } });
  assert.equal(plan.matrix.include.length, 1);
  assert.equal(plan.publish, true);
  assert.equal(ciPlan({ version: '0.1.0', ref: 'refs/tags/v0.1.0' }).mode, 'release');
});

test('installer verification reuses only a Windows artifact and cannot publish it', () => {
  const inputs = { mode: 'verify', target: 'win32-x64', run_id: '12345' };
  assert.equal(ciPlan({version:'0.1.0', inputs}).mode, 'verify');
  assert.throws(() => ciPlan({version:'0.1.0', inputs:{...inputs, target:'all'}}));
  assert.throws(() => ciPlan({version:'0.1.0', inputs:{...inputs, run_id:'bad'}}));
  assert.throws(() => ciPlan({version:'0.1.0', inputs:{...inputs, publish_draft:true}}));
});
