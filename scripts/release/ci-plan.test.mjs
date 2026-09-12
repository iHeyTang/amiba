import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciPlan as createPlan } from './ci-plan.mjs';
const ciPlan = options => createPlan({ ref: 'refs/heads/main', ...options });
test('CI uses a native runner for each architecture and defaults to test builds', () => {
  const plan = ciPlan({ version: '0.1.0' });
  assert.equal(plan.matrix.include.length, 3);
  assert.equal(plan.mode, 'test');
  assert.equal(plan.publish, false);
  assert.equal(plan.matrix.include.find(row => row.target === 'win32-x64').runner, 'windows-2022');
});
test('CI rejects non-main refs and prevents publishing disabled test updates', () => {
  assert.throws(() => ciPlan({ ref: 'refs/tags/v1.0.0', version: '0.1.0' }));
  assert.throws(() => ciPlan({ version: '0.1.0', inputs: { publish_draft: 'true' } }));
  const plan = ciPlan({ version: '0.1.0', inputs: { target: 'win32-x64', mode: 'release', publish_draft: 'true' } });
  assert.equal(plan.matrix.include.length, 1);
  assert.equal(plan.publish, true);
  for (const ref of ['refs/heads/feat/amiba-distribution', 'refs/tags/v0.1.0', '']) {
    assert.throws(() => ciPlan({ version: '0.1.0', ref }), /only runs on main/);
  }
});

test('installer verification reuses only a Windows artifact and cannot publish it', () => {
  const inputs = { mode: 'verify', target: 'win32-x64', run_id: '12345' };
  assert.equal(ciPlan({version:'0.1.0', inputs}).mode, 'verify');
  assert.throws(() => ciPlan({version:'0.1.0', inputs:{...inputs, target:'all'}}));
  assert.throws(() => ciPlan({version:'0.1.0', inputs:{...inputs, run_id:'bad'}}));
  assert.throws(() => ciPlan({version:'0.1.0', inputs:{...inputs, publish_draft:true}}));
});
