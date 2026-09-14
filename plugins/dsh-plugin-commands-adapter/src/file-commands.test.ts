import { createRequire } from 'node:module';
import { Context } from '@deepseek-ai/cordis';
import { CommandRuntime } from '@deepseek-ai/dsh-commands';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { TYPERT } from '@deepseek-ai/dsh-commands/typert';
import { expect, it, vi } from 'vitest';

function fixture() {
  const ctx = new Context();
  const imageRef = { attachmentId: 'image-id', mediaType: 'image/png', width: 1, height: 1, bytes: 1 };
  const saveImages = vi.fn(async () => [imageRef]);
  ctx.provide('attachments', { saveImages });
  const commands = new CommandRuntime(ctx);
  const append = vi.fn();
  const agent = { session: { append }, ctx } as unknown as Agent;
  const handler = vi.fn(() => ({ kind: 'success' as const, text: 'accepted' }));
  const file = { attachmentId: 'sha256:file', name: 'document.txt', bytes: 9 };
  commands.register({ name: 'file', description: 'files', input: { hint: 'file', attachments: true }, handler });
  const off = commands.registerFileReceiptResolver((owner, receipt) => owner === agent && receipt === 'receipt' ? file : undefined);
  return { ctx, commands, agent, handler, append, saveImages, file, imageRef, off };
}
const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==' };
const file = { type: 'file' as const, receiptId: 'receipt' };
const signal = () => new AbortController().signal;

it('resolves file receipts and preserves interleaved file/image order and immutable handler values', async () => {
  const f = fixture();
  const result = await f.commands.execute(f.agent, '/file raw', [file, image, file], signal());
  expect(result?.result.kind).toBe('success');
  const invocation = (f.handler.mock.calls as unknown as Array<[any]>)[0][0];
  expect(invocation.attachments).toEqual([{type:'file',attachment:f.file},{type:'image',attachment:f.imageRef},{type:'file',attachment:f.file}]);
  expect(Object.isFrozen(invocation.attachments)).toBe(true);
  expect(f.append.mock.calls.map(call => call[0])).toEqual(['command/run','command/done']);
  expect(f.commands.list(f.agent)[0].input?.attachments).toBe(true);
});

it('rejects foreign receipts before image writes, and unregisters the exact resolver', async () => {
  const f = fixture();
  const result = await f.commands.execute(f.agent, '/file', [image, {type:'file',receiptId:'foreign'}], signal());
  expect(result?.result.kind).toBe('error'); expect(f.saveImages).not.toHaveBeenCalled(); expect(f.handler).not.toHaveBeenCalled();
  expect(() => f.commands.registerFileReceiptResolver(() => f.file)).toThrow('already registered');
  f.off();
  expect((await f.commands.execute(f.agent, '/file', [file], signal()))?.result.kind).toBe('error');
});

it('retains legacy image admission and gives explicit newer refusal precedence', async () => {
  const f = fixture();
  f.commands.register({ name:'legacy', description:'legacy', input:{hint:'image',images:true}, handler:f.handler });
  expect((await f.commands.execute(f.agent,'/legacy',[image],signal()))?.result.kind).toBe('success');
  expect((await f.commands.execute(f.agent,'/legacy',[file],signal()))?.result.kind).toBe('error');
  f.commands.register({ name:'refuse',description:'refuse',input:{hint:'none',images:true,attachments:false},handler:f.handler });
  expect((await f.commands.execute(f.agent,'/refuse',[image],signal()))?.result.kind).toBe('error');
});

it('honors cancellation after admission and retains error settlement without entering the handler', async () => {
  const f = fixture(); const abort = new AbortController();
  f.saveImages.mockImplementationOnce(async () => { abort.abort(); return [f.imageRef]; });
  await expect(f.commands.execute(f.agent,'/file',[file,image],abort.signal)).rejects.toThrow();
  expect(f.handler).not.toHaveBeenCalled();
  expect(f.append.mock.calls.at(-1)?.[1]).toMatchObject({kind:'error'});
});

it('accepts both wire dialects through the installed Host parameter schemas', async () => {
  const f = fixture();
  const contribution = TYPERT as { invocations: Array<{ method: string; implementation?: string; parameters: Array<{source:string;wire:string;codec:{schema:{parse(value:unknown):unknown}}}> }> };
  const endpoint = contribution.invocations.find(item => item.method === 'execute')!;
  async function invoke(payload: Record<string, unknown>) {
    const args = endpoint.parameters.map(parameter => parameter.source === 'lookup' ? f.agent : (parameter.codec as any).schema.parse(payload[parameter.wire]));
    return ((f.commands as unknown as Record<string, Function>)[endpoint.implementation ?? endpoint.method]).apply(f.commands, [...args, signal()]);
  }
  expect((await invoke({line:'/file',images:[file]})).result.kind).toBe('success');
  expect((await invoke({line:'/file',submittedAttachments:[file]})).result.kind).toBe('success');
  await expect(invoke({line:'/file',submittedAttachments:[{type:'file',receiptId:42}]})).rejects.toThrow();
  await expect(invoke({line:'/file',images:[],submittedAttachments:[file]})).rejects.toThrow('only one');
});

it('allows a scoped resolver owner to unload and register again through Cordis', async () => {
  const f = fixture(); f.off();
  const scoped = await new Promise<CommandRuntime>(resolve => { f.ctx.inject(['commands'], ctx => { resolve(ctx.commands); }); });
  const off = scoped.registerFileReceiptResolver(() => f.file); off();
  const next = scoped.registerFileReceiptResolver(() => f.file); next();
});

it('ships the mixed attachment contract in the actual browser API bundle', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const require = createRequire(new URL('../../../packages/extension-sdk/package.json', import.meta.url));
  const bundle = await readFile(require.resolve('@deepseek-ai/dsh-api-remotes/client'), 'utf8');
  let plugin: any;
  runInNewContext(bundle, { window: { __ModuleLoader__: { load: (entry: any) => { plugin = entry.factory(() => { throw new Error('Unexpected external module'); }); } } } });
  const contributions: any[] = [];
  const off = await plugin.apply({remote:{$mount:async (entry:any) => { contributions.push(entry); return () => {}; }}});
  const command = contributions.find(entry => entry.package === '@deepseek-ai/dsh-commands');
  const execute = command.descriptors.find((entry:any) => entry.method === 'execute');
  expect(execute.parameters[2].codec.schema.parse([file,image])).toEqual([file,image]);
  expect(() => execute.parameters[2].codec.schema.parse([{type:'file',receiptId:42}])).toThrow();
  const list = command.descriptors.find((entry:any) => entry.method === 'list');
  expect(list.result.schema.parse([{name:'file',description:'file',input:{hint:'file',attachments:true}}])[0].input.attachments).toBe(true);
  await off();
});
