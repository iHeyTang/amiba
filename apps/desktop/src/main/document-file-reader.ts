// Line paging adapted from DeepSeek c291e796, MIT. See apps/desktop/LICENSE.deepseek.
import { open, type FileHandle } from 'node:fs/promises';

/** Callers must authorize and canonicalize the session path before reading. */
export interface DocumentReadLimits { maxBytes: number; maxFileBytes: number; maxLines: number }
export const DOCUMENT_READ_LIMITS: Readonly<DocumentReadLimits> = { maxBytes: 2 * 1024 * 1024, maxFileBytes: 32 * 1024 * 1024, maxLines: 5000 };
import type { WorkspaceDocumentReadRequest as DocumentReadRequest } from '@amiba/app-runtime/platform';
export class DocumentReadError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(code: string, message: string, details: Readonly<Record<string, unknown>>) {
    super(message); this.name = 'DocumentReadError'; this.code = code; this.details = details;
  }
}
function integer(value: number, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new DocumentReadError('gateway/bad-request', `${name} must be a safe integer of at least ${minimum}`, {});
  return value;
}
function tooLarge(path: string, limit: number): never {
  throw new DocumentReadError('workspace-file/too-large', `Document exceeds the ${limit} byte read limit`, { path, limit });
}
function notText(path: string): never {
  throw new DocumentReadError('workspace-file/not-text', 'Document is not UTF-8 text', { path });
}
async function* textChunks(handle: FileHandle, path: string, signal?: AbortSignal): AsyncIterable<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  for (;;) {
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    signal?.throwIfAborted();
    const chunk = buffer.subarray(0, bytesRead);
    if (position < 8192 && chunk.subarray(0, 8192 - position).includes(0)) notText(path);
    position += bytesRead;
    try { yield bytesRead ? decoder.decode(chunk, { stream: true }) : decoder.decode(); }
    catch (error) { if (error instanceof TypeError) notText(path); throw error; }
    if (!bytesRead) return;
  }
}
/** Line-window semantics match fixed DSH c291e796: LF ends a line, never adds a trailing empty line. */
async function textPage(chunks: AsyncIterable<string>, offset: number, limit: number, maxBytes: number, path: string) {
  const last = offset + limit - 1;
  const lines: string[] = [];
  let current = '', bytes = 0, line = 1;
  const admit = (size: number) => { bytes += size; if (bytes > maxBytes) tooLarge(path, maxBytes); };
  const complete = () => { if (lines.length) admit(1); lines.push(current); current = ''; };
  for await (const chunk of chunks) {
    let position = 0;
    while (position < chunk.length) {
      if (line > last) return { text: lines.join('\n'), lines: lines.length, eof: false };
      const newline = chunk.indexOf('\n', position);
      const segment = newline < 0 ? chunk.slice(position) : chunk.slice(position, newline);
      if (line >= offset) { admit(Buffer.byteLength(segment, 'utf8')); current += segment; }
      if (newline < 0) break;
      if (line >= offset) complete();
      line++; position = newline + 1;
    }
  }
  if (current.length) complete();
  return { text: lines.join('\n'), lines: lines.length, eof: true };
}
/** Bounded reads over one opened file, with metadata from that same descriptor. */
export async function readDocumentFile(resolved: { path: string }, request: DocumentReadRequest, signal?: AbortSignal, limits: Readonly<DocumentReadLimits> = DOCUMENT_READ_LIMITS) {
  signal?.throwIfAborted();
  const path = resolved.path;
  const offset = request.kind === 'all' ? 0 : integer(request.offset ?? (request.kind === 'text' ? 1 : 0), request.kind === 'text' ? 1 : 0, 'offset');
  const length = request.kind === 'all' ? limits.maxFileBytes + 1 : request.kind === 'text' ? integer(request.limit ?? limits.maxLines, 1, 'limit') : integer(request.length ?? limits.maxBytes, 1, 'length');
  if (request.kind === 'text' && length > limits.maxLines) throw new DocumentReadError('gateway/bad-request', `limit must be at most ${limits.maxLines}`, {});
  if (request.kind === 'bytes' && offset + length > Number.MAX_SAFE_INTEGER) throw new DocumentReadError('gateway/bad-request', 'offset plus length must stay a safe integer', {});
  if (request.kind === 'bytes' && length > limits.maxBytes) tooLarge(path, limits.maxBytes);
  let handle: FileHandle;
  try { handle = await open(path, 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new DocumentReadError('workspace-file/not-found', 'Document does not exist', { path }); throw error; }
  try {
    signal?.throwIfAborted();
    const info = await handle.stat({ bigint: true });
    if (!info.isFile()) throw new DocumentReadError('workspace-file/not-regular-file', 'Document is not a regular file', { path, kind: info.isDirectory() ? 'directory' : 'other' });
    const metadata = { absolutePath: path, version: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`, bytes: Number(info.size) };
    if (request.kind === 'text') {
      const page = await textPage(textChunks(handle, path, signal), offset, length, limits.maxBytes, path);
      if (page.text.includes('\0')) notText(path);
      return { ...metadata, offset, ...page };
    }
    if (request.kind === 'all' && metadata.bytes > limits.maxFileBytes) tooLarge(path, limits.maxFileBytes);
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
      signal?.throwIfAborted();
      if (!bytesRead) break;
      read += bytesRead;
    }
    if (request.kind === 'all' && read > limits.maxFileBytes) tooLarge(path, limits.maxFileBytes);
    return { ...metadata, offset, data: buffer.subarray(0, read).toString('base64'), eof: request.kind === 'all' || offset + read >= metadata.bytes };
  } finally { await handle.close(); }
}
