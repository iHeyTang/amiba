import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdateController } from '../updates/controller.ts';
class FakeUpdater extends EventEmitter {
  attempts = [];
  setFeedURL({ url }) { this.url = url; }
  async checkForUpdates() {
    this.attempts.push(this.url);
    if (this.url.includes('offline')) throw new Error('offline');
    this.emit('update-available', { version: '0.4.0' });
  }
  async downloadUpdate() { this.emit('update-downloaded', { version: '0.4.0' }); }
}
test('deduplicates checks and falls back before installing a verified download', async () => {
  const updater = new FakeUpdater();
  let quit = 0;
  const controller = createUpdateController({ updater, sources: ['https://offline', 'https://cdn'], currentVersion: '0.3.0', notify: () => {}, quit: () => { quit += 1; } });
  assert.throws(() => controller.install());
  const first = controller.check('latest-arm64');
  assert.equal(first, controller.check('latest-arm64'));
  assert.equal((await first).status, 'downloaded');
  assert.deepEqual(updater.attempts, ['https://offline', 'https://cdn']);
  controller.install();
  controller.install();
  assert.equal(quit, 1);
  assert.equal(updater.autoInstallOnAppQuit, false);
});
test('all sources failing is retryable; disabled builds do not access network', async () => {
  const updater = new FakeUpdater();
  const controller = createUpdateController({ updater, sources: ['https://offline'], currentVersion: '0.3.0', notify: () => {}, quit: () => {} });
  assert.equal((await controller.check('latest-x64')).status, 'error');
  assert.equal((await controller.check('latest-x64')).status, 'error');
  assert.equal(updater.attempts.length, 2);
  const disabled = createUpdateController({ updater: new FakeUpdater(), sources: [], currentVersion: '0.3.0', notify: () => {}, quit: () => {} });
  assert.equal((await disabled.check('latest-x64')).status, 'disabled');
});

test('cancels the transfer, ignores late events and does not retry another source', async () => {
  const updater = new FakeUpdater();
  let rejectDownload;
  let downloads = 0;
  const token = { cancelled: false, cancel() { this.cancelled = true; rejectDownload(new Error('cancelled')); } };
  updater.checkForUpdates = async function () {
    this.attempts.push(this.url);
    this.emit('update-available', { version: '0.4.0' });
    return { cancellationToken: token };
  };
  updater.downloadUpdate = async function (receivedToken) {
    assert.equal(receivedToken, token);
    downloads++;
    if (downloads === 1) return new Promise((_, reject) => { rejectDownload = reject; });
    this.emit('update-downloaded', { version: '0.4.0' });
  };
  const controller = createUpdateController({ updater, sources: ['https://cdn', 'https://fallback'], currentVersion: '0.3.0', notify: () => {}, quit: () => {} });
  const pending = controller.check('latest-arm64');
  await Promise.resolve();
  assert.equal((await controller.cancel()).status, 'cancelled');
  assert.equal((await pending).status, 'cancelled');
  assert.equal(token.cancelled, true);
  assert.deepEqual(updater.attempts, ['https://cdn']);
  updater.emit('download-progress', { percent: 90 });
  updater.emit('update-downloaded', { version: '0.4.0' });
  assert.equal(controller.getState().status, 'cancelled');
  assert.throws(() => controller.install());
  assert.equal((await controller.check('latest-arm64')).status, 'cancelled');
  assert.equal(downloads, 1, 'automatic detection must not resume a cancelled version');
  assert.equal((await controller.check('latest-arm64', true)).status, 'downloaded');
  assert.equal(downloads, 2);
});
