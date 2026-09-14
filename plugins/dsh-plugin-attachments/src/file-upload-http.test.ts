import { Context, Service } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { handleFileUploadHttp, FILE_UPLOAD_PATH } from './file-upload-http.js';
import { FileUploadError } from './file-uploads.js';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const off of cleanup.splice(0).reverse()) await off(); });

it('validates HTTP metadata before consuming bytes and preserves structured upload failures', async () => {
  const uploadStream = vi.fn(async () => { throw new FileUploadError('SUBAGENT_FILE_UNSUPPORTED', 'unsupported', { sessionId: 'child' }); });
  const service = { uploadStream };
  expect((await handleFileUploadHttp(service, new Request('http://localhost' + FILE_UPLOAD_PATH))).status).toBe(405);
  expect((await handleFileUploadHttp(service, new Request('http://localhost' + FILE_UPLOAD_PATH, { method: 'POST' }))).status).toBe(415);
  expect((await handleFileUploadHttp(service, new Request('http://localhost' + FILE_UPLOAD_PATH, { method: 'POST', headers: { 'content-type': 'application/octet-stream' } }))).status).toBe(400);
  expect(uploadStream).not.toHaveBeenCalled();
  const response = await handleFileUploadHttp(service, new Request('http://localhost' + FILE_UPLOAD_PATH + '?sessionId=child', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'abc' }));
  expect(await response.json()).toEqual({ ok: false, error: { code: 'SUBAGENT_FILE_UNSUPPORTED', message: 'unsupported', details: { sessionId: 'child' } } });
});

it('streams through the shipped Connection bridge before EOF, retains its trust fence and buffered RPC cap', async () => {
  const source = await readFile(new URL('../../../packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js', import.meta.url), 'utf8');
  // Execute the actual prepared bridge/registry/trust implementation without unrelated WS dependencies.
  const start = source.indexOf('async function bridge(');
  const end = source.indexOf('function rpcFetchHandler(');
  const api = runInNewContext(source.slice(start, end) + '\n({ bridge, HostConnectionService, isTrustedApiRequest })', {
    Service, AmibaReadable: Readable, RpcId: (value: string) => value,
    Request, Response, Headers, URL, AbortController, Buffer,
  });
  const ctx = new Context();
  const connection = new api.HostConnectionService(ctx, []);
  let firstChunk!: () => void;
  const first = new Promise<void>(resolve => { firstChunk = resolve; });
  let received = '';
  const off = connection.fetch.register({ path: FILE_UPLOAD_PATH, methods: ['POST'], requestBody: 'streaming',
    fetch: (request: Request) => handleFileUploadHttp({ uploadStream: async ({ data }) => {
      for await (const chunk of data) { received += Buffer.from(chunk).toString(); firstChunk(); }
      return { receiptId: 'real-stream', file: { attachmentId: 'digest', name: 'a.txt', bytes: received.length } } as any;
    } }, request) });
  cleanup.push(off);
  const fallback = vi.fn(async () => new Response('rpc'));
  const handler = connection.createSharedFetchHandler('/api', { fetch: fallback });
  const server = createServer((req, res) => {
    if (!api.isTrustedApiRequest(req, [])) { res.writeHead(403); res.end(); return; }
    void api.bridge(req, res, handler, 4).catch((error: Error) => res.destroy(error));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  let responseDone!: Promise<string>;
  const req = httpRequest(base + FILE_UPLOAD_PATH + '?sessionId=owner&name=a.txt', { method: 'POST', headers: { 'content-type': 'application/octet-stream' } });
  responseDone = new Promise((resolve, reject) => { req.on('error', reject); req.on('response', res => { let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve(text)); }); });
  req.write('first');
  await first; // The server must receive bytes while the client still holds the request open.
  expect(received).toBe('first');
  req.end('-second');
  expect(JSON.parse(await responseDone)).toMatchObject({ ok: true, value: { file: { bytes: 12 } } });
  expect((await fetch(base + FILE_UPLOAD_PATH + '?sessionId=owner', { method: 'POST', headers: { 'content-type': 'application/octet-stream', origin: 'https://foreign.invalid' }, body: 'bad' })).status).toBe(403);
  expect((await fetch(base + '/api/ordinary', { method: 'POST', body: '12345' })).status).toBe(413);
  expect(fallback).not.toHaveBeenCalled();
  let began!: () => void;
  let cancelled!: () => void;
  const begun = new Promise<void>(resolve => { began = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  cleanup.push(connection.fetch.register({ path: '/api/cancel-upload', methods: ['POST'], requestBody: 'streaming', fetch: async (request: Request) => {
    request.signal.addEventListener('abort', cancelled, { once: true });
    began();
    await aborted;
    return new Response(null);
  } }));
  const cancelRequest = httpRequest(base + '/api/cancel-upload', { method: 'POST' });
  cancelRequest.on('error', () => {});
  cancelRequest.write('open');
  await begun;
  cancelRequest.destroy();
  await aborted;
  await off();
  expect(handler.requestBodyMode({ method: 'POST', url: new URL(base + FILE_UPLOAD_PATH) })).toBe('buffered');
}, 10000);
