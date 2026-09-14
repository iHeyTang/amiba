// Adapted from deepseek-harness c291e796, MIT; see ../LICENSE.deepseek.
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { FileUploadError, type FileUploads } from './file-uploads.js';

export const FILE_UPLOAD_PATH = '/api/session/uploadFileBinary';

export async function handleFileUploadHttp(service: Pick<FileUploads, 'uploadStream'>, request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/octet-stream') {
    return new Response('content type must be application/octet-stream', { status: 415 });
  }
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return new Response('sessionId is required', { status: 400 });
  const name = url.searchParams.get('name');
  let result: unknown;
  try {
    result = { ok: true, value: await service.uploadStream({
      sessionId: sessionId as SessionId,
      data: bodyChunks(request.body), signal: request.signal,
      ...(name === null ? {} : { name }),
    }) };
  } catch (error) {
    result = { ok: false, error: error instanceof FileUploadError
      ? { code: error.code, message: error.message, details: error.data }
      : { code: 'gateway/internal', message: error instanceof Error ? error.message : String(error), details: {} } };
  }
  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

async function* bodyChunks(body: ReadableStream<Uint8Array> | null): AsyncIterable<Uint8Array> {
  if (!body) return;
  const reader = body.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) return;
      yield item.value;
    }
  } finally { reader.releaseLock(); }
}

/** Register inside Connection's existing trust fence, never a bypassing WebServer route. */
export function applyFileUploadHttp(ctx: Context, service: FileUploads): void {
  ctx.inject(['connection'], scope => {
    const connection = scope.get('connection') as { fetch?: { register(route: {
      path: string; methods: string[]; requestBody: 'streaming'; fetch(request: Request): Promise<Response>;
    }): unknown } } | undefined;
    connection?.fetch?.register({ path: FILE_UPLOAD_PATH, methods: ['POST'], requestBody: 'streaming',
      fetch: request => handleFileUploadHttp(service, request) });
  });
}
