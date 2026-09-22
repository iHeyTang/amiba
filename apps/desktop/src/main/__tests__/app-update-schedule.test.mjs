import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleUpdateChecks } from '../updates/schedule.ts';

test('checks automatically on startup, periodically, and when returning after sleep', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let checks = 0;
  const schedule = scheduleUpdateChecks(async () => { checks++; });
  t.mock.timers.tick(29_999);
  assert.equal(checks, 0);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(checks, 1);
  t.mock.timers.tick(6 * 60 * 60 * 1000);
  await Promise.resolve();
  assert.equal(checks, 2);
  await schedule.checkIfDue();
  assert.equal(checks, 2, 'focus must not cause repeated network requests');
  t.mock.timers.setTime(Date.now() + 7 * 60 * 60 * 1000);
  await schedule.checkIfDue();
  assert.equal(checks, 3);
  schedule.dispose();
  t.mock.timers.tick(12 * 60 * 60 * 1000);
  await schedule.checkIfDue();
  assert.equal(checks, 3);
});
