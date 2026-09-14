import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';

const workflow = name => YAML.parse(fs.readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));

test('PR and main receive validation without automatically packaging or publishing', () => {
  for (const name of ['ci', 'runtime-dependencies']) {
    const config = workflow(name);
    assert.deepEqual(config.on.pull_request.branches, ['main']);
    assert.deepEqual(config.on.push.branches, ['main']);
    assert.equal(config.permissions.contents, 'read');
    assert.doesNotMatch(JSON.stringify(config.jobs), /release:build|ci-upload\.mjs/);
  }
  assert.equal(workflow('ci').jobs.checks.name, 'PR checks', 'preserve the required check name');
});

test('test packaging is manual and has no release job or signing credentials', () => {
  const config = workflow('desktop-build');
  assert.deepEqual(Object.keys(config.on), ['workflow_dispatch']);
  assert.deepEqual(config.on.workflow_dispatch.inputs.mode.options, ['test', 'verify']);
  assert.equal(config.permissions.contents, 'read');
  assert.equal(config.jobs.release, undefined);
  assert.doesNotMatch(JSON.stringify(config), /contents":"write|secrets\.|ci-upload\.mjs|AMIBA_CI_MODE/);
});

test('formal publication is manual, serialized, and gated by validation and all builds', () => {
  const config = workflow('desktop-release');
  assert.deepEqual(Object.keys(config.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(config.on.workflow_dispatch.inputs), ['mac_signing']);
  assert.equal(config.concurrency['cancel-in-progress'], false);
  assert.equal(config.jobs.checks.uses, './.github/workflows/ci.yml');
  assert.deepEqual(config.jobs.build.needs, ['plan', 'checks']);
  assert.deepEqual(config.jobs.release.needs, ['plan', 'build']);
  assert.equal(config.jobs.plan.steps.find(step => step.id === 'plan').env.AMIBA_CI_MODE, 'release');
  assert.equal(config.jobs.release.permissions.contents, 'write');
  assert.equal(config.jobs.plan.permissions.contents, 'read');
  assert.match(config.jobs.release.if, /publish == 'true'/);
});
