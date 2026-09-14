import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createScope } from '@deepseek-ai/dsh-scope';
import type { Session } from '@deepseek-ai/dsh-session';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FileUploads } from './file-uploads.js';
import { createOfficialFileStorage } from './official-file-storage/index.js';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const off of cleanup.splice(0).reverse()) await off(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'amiba-receipts-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const ctx = new Context();
  const agents = new Map<string, Agent>();
  ctx.provide('agents');
  ctx.set('agents', { get: (id: string) => agents.get(id) });
  const storage = createOfficialFileStorage(join(root, 'files', 'v1'));
  ctx.provide('attachments');
  ctx.set('attachments', storage);
  const uploads = new FileUploads(ctx, storage);
  function agent(id: string, origin = 'user') {
    const value = { id, session: { header: { origin } } as Session } as Agent;
    const scope = createScope(ctx, value);
    Object.assign(value, { ctx: scope.ctx });
    cleanup.push(() => scope.dispose());
    agents.set(id, value);
    return value;
  }
  return { ctx, agents, storage, uploads, agent };
}
const signal = () => new AbortController().signal;

it('stages durable bytes under the exact session and prevents foreign or recreated sessions resolving receipts', async () => {
  const { uploads, storage, agent } = await fixture();
  const owner = agent('owner');
  const value = await uploads.upload(owner, { data: 'AP8q', name: '../binary.bin' }, signal());
  expect(value.file).toMatchObject({ name: 'binary.bin', bytes: 3 });
  const chunks = []; for await (const chunk of storage.readFileStream(value.file)) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 255, 42]));
  expect(uploads.resolve(owner, value.receiptId)).toEqual(value.file);
  expect(uploads.resolve(agent('foreign'), value.receiptId)).toBeUndefined();
  expect(uploads.resolve(agent('owner'), value.receiptId)).toBeUndefined();
  expect(() => uploads.resolve({ ...owner, ctx: new Context() } as Agent, value.receiptId)).toThrow('own scope');
});

it('rolls back failed admission and retires only successfully bound receipts', async () => {
  const { uploads, agent } = await fixture(); const owner = agent('owner');
  const first = await uploads.upload(owner, { data: 'AQ==' }, signal());
  const second = await uploads.upload(owner, { data: 'Ag==' }, signal());
  const original = uploads.bindPrompt(owner, [first.receiptId], 'original'); original.commit();
  expect(() => uploads.bindPrompt(owner, [first.receiptId, 'missing'], 'invalid')).toThrow('not uploaded');
  const failed = uploads.bindPrompt(owner, [first.receiptId, second.receiptId], 'failed'); failed[Symbol.dispose]();
  uploads.retirePrompt(owner, 'failed');
  expect(uploads.resolve(owner, first.receiptId)).toBeDefined();
  uploads.retirePrompt(owner, 'original');
  expect(uploads.resolve(owner, first.receiptId)).toBeUndefined();
  expect(uploads.resolve(owner, second.receiptId)).toBeDefined();
  const accepted = uploads.bindPrompt(owner, [second.receiptId], 'accepted'); accepted.commit(); accepted[Symbol.dispose]();
  uploads.retirePrompt(owner, 'accepted');
  expect(uploads.resolve(owner, second.receiptId)).toBeUndefined();
});

it('releases receipts on matching user history or session disposal', async () => {
  const { ctx, uploads, agent } = await fixture(); const owner = agent('owner');
  const first = await uploads.upload(owner, { data: 'AQ==' }, signal());
  uploads.bindPrompt(owner, [first.receiptId], 'sent').commit();
  ctx.emit('session/event', owner.session, { type: 'user/message', data: { source: { kind: 'user', rpcId: 'sent' } } } as never);
  expect(uploads.resolve(owner, first.receiptId)).toBeUndefined();
  const second = await uploads.upload(owner, { data: 'Ag==' }, signal());
  ctx.emit('session/disposed', owner.session);
  expect(uploads.resolve(owner, second.receiptId)).toBeUndefined();
});

it('rejects unsupported or cancelled intake and does not mint authority for a disposed agent', async () => {
  const { uploads, agents, agent } = await fixture(); const owner = agent('owner');
  await expect(uploads.upload(agent('child', 'subagent'), { data: 'AQ==' }, signal())).rejects.toMatchObject({ data: { reason: 'SUBAGENT_FILE_UNSUPPORTED' } });
  await expect(uploads.upload(owner, { data: '???' }, signal())).rejects.toMatchObject({ data: { reason: 'INVALID_FILE_BASE64' } });
  const aborted = new AbortController(); aborted.abort();
  expect(() => uploads.upload(owner, { data: 'AQ==' }, aborted.signal)).toThrow();
  await expect(uploads.uploadStream({ sessionId: owner.id, data: (async function* () {
    yield Buffer.from('first'); agents.delete(owner.id); yield Buffer.from('last');
  })() })).rejects.toMatchObject({ code: 'session/not-found' });
});

it('resolves cold sessions through one registered authority and removes that authority on disposal', async () => {
  const { uploads, agent } = await fixture();
  const off = uploads.registerAgentResolver(async id => agent(id));
  expect(() => uploads.registerAgentResolver(async id => agent(id))).toThrow('already registered');
  const value = await uploads.uploadStream({ sessionId: 'cold' as never, data: (async function* () { yield Buffer.from('cold'); })() });
  expect(value.file.bytes).toBe(4);
  off();
  await expect(uploads.uploadStream({ sessionId: 'missing' as never, data: (async function* () {})() })).rejects.toMatchObject({ code: 'session/not-found' });
});

it('releases a cold-session resolver registered through the Cordis service facade', async () => {
  const { ctx, agent } = await fixture();
  const scoped = await new Promise<FileUploads>(resolve => { ctx.inject(['fileUploads'], scope => { resolve(scope.fileUploads); }); });
  const off = scoped.registerAgentResolver(async id => agent(id)); off();
  const next = scoped.registerAgentResolver(async id => agent(id)); next();
});
