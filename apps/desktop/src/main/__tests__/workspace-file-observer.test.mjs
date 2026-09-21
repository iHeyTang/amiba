import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { observeWorkspaceFile, resolveWorkspaceWatchPath } from '../workspace-file-observer.ts';

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('File notification timed out');
    await delay(20);
  }
}

test('watch paths allow missing descendants but reject outside and dangling symlinks', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'amiba-watch-path-'));
  const outside = await fs.mkdtemp(path.join(tmpdir(), 'amiba-watch-outside-'));
  try {
    const canonical = await fs.realpath(root);
    assert.deepEqual(await resolveWorkspaceWatchPath(root, 'not/yet/file.txt'), {
      root: canonical, path: path.join(canonical, 'not/yet/file.txt'),
    });
    await fs.symlink(outside, path.join(root, 'escape'), 'dir');
    for (const candidate of [path.join(outside, 'missing'), path.relative(root, path.join(outside, 'missing')), 'escape/missing']) {
      await assert.rejects(resolveWorkspaceWatchPath(root, candidate), /outside this conversation/);
    }
    await fs.symlink(path.join(outside, 'not-created'), path.join(root, 'dangling'), 'dir');
    await assert.rejects(resolveWorkspaceWatchPath(root, 'dangling/file'), { code: 'ENOENT' });
    await assert.rejects(resolveWorkspaceWatchPath(root, '.'), /not a file/);
    await fs.mkdir(path.join(root, 'inside'));
    await fs.symlink(path.join(root, 'inside'), path.join(root, 'alias'), 'dir');
    assert.equal((await resolveWorkspaceWatchPath(root, 'alias/future')).path, path.join(canonical, 'inside/future'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('native observation sees missing nested file creation, writes, deletion and recreation without tree scanning', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'amiba-watch-events-'));
  const controller = new AbortController();
  const file = path.join(root, '.cache', 'nested', 'a #?.txt');
  let events = 0;
  let dispose;
  try {
    dispose = await observeWorkspaceFile(root, '.cache/nested/a #?.txt', () => events++, controller.signal);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'first');
    await until(() => events > 0);
    let before = events;
    await fs.writeFile(file, 'changed content');
    await until(() => events > before);
    before = events;
    await fs.rm(file);
    await until(() => events > before);
    before = events;
    await fs.writeFile(file, 'returned');
    await until(() => events > before);
    before = events;
    await fs.rm(path.join(root, '.cache'), { recursive: true });
    await until(() => events > before);
    before = events;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'parent recreated');
    await until(() => events > before);
    before = events;
    await fs.rm(file);
    await until(() => events > before);
    before = events;
    await fs.mkdir(file);
    await until(() => events > before);
    await fs.rm(file, { recursive: true });
    await fs.writeFile(file, 'file again');
    await delay(100);
    before = events;
    await fs.mkdir(path.join(root, 'unrelated'), { recursive: true });
    await fs.writeFile(path.join(root, 'unrelated', 'other.txt'), 'not this resource');
    await delay(100);
    assert.equal(events, before);
    controller.abort();
    await dispose();
    before = events;
    await fs.writeFile(file, 'after abort');
    await delay(100);
    assert.equal(events, before);
    await dispose();
  } finally {
    controller.abort();
    await dispose?.();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('two sessions sharing a real path share one watcher until the final subscriber leaves', async () => {
  const { default: chokidar } = await import('chokidar');
  const original = chokidar.watch;
  let opens = 0, closes = 0;
  chokidar.watch = (...args) => {
    opens++;
    const watcher = original(...args);
    const close = watcher.close.bind(watcher);
    watcher.close = () => { closes++; return close(); };
    return watcher;
  };
  const root = await fs.mkdtemp(path.join(tmpdir(), 'amiba-watch-shared-'));
  const alias = `${root}-alias`;
  const a = new AbortController(), b = new AbortController();
  let first = 0, second = 0;
  const file = path.join(root, 'file.txt');
  try {
    await fs.writeFile(file, 'initial');
    await fs.symlink(root, alias, 'dir');
    const [offA, offB] = await Promise.all([
      observeWorkspaceFile(root, 'file.txt', () => first++, a.signal),
      observeWorkspaceFile(alias, 'file.txt', () => second++, b.signal),
    ]);
    assert.equal(opens, 1);
    await fs.writeFile(file, 'both');
    await until(() => first > 0 && second > 0);
    a.abort(); await offA();
    assert.equal(closes, 0);
    const previousFirst = first, previousSecond = second;
    await fs.writeFile(file, 'only second subscriber');
    await until(() => second > previousSecond);
    assert.equal(first, previousFirst);
    b.abort(); await offB(); await offB();
    assert.equal(closes, 1);
    const c = new AbortController();
    const offC = await observeWorkspaceFile(root, 'file.txt', () => {}, c.signal);
    assert.equal(opens, 2);
    c.abort(); await offC();
  } finally {
    a.abort(); b.abort(); chokidar.watch = original;
    await fs.rm(alias, { force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});
