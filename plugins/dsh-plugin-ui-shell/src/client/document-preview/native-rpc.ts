import type { WorkspaceDocumentContent, WorkspaceDocumentReadRequest, WorkspaceFilesAdapter } from '@amiba/app-runtime/platform'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ReadDocumentBytes, ReadWorkspaceFilePage } from './rpc.js'
import type { WorkspaceFileBytes, WorkspaceFileText } from './wire.js'

const aborted = (): RemoteResult<never> => ({ ok: false, error: { code: 'ABORT_ERR', message: 'Document read cancelled', details: {} } })
/** Adapt desktop operations to the non-rejecting read contract used by the document face. */
export function nativeDocumentReads(files: Pick<WorkspaceFilesAdapter, 'readDocument'>): { readPage: ReadWorkspaceFilePage; readAll: ReadDocumentBytes } {
  async function read<T extends WorkspaceDocumentContent>(sessionId: string, path: string, request: WorkspaceDocumentReadRequest, signal: AbortSignal, accepts: (value: WorkspaceDocumentContent) => value is T): Promise<RemoteResult<T>> {
    if (signal.aborted) return aborted()
    if (!files.readDocument) return { ok: false, error: { code: 'workspace-file/unsupported', message: 'This host does not provide document reads', details: { path } } }
    try {
      const operation = files.readDocument(sessionId, path, request)
      const cancel = () => operation.dispose()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        if (signal.aborted) { cancel(); return aborted() }
        const result = await operation.result
        if (signal.aborted) return aborted()
        if (!result.ok) return { ok: false, error: { code: result.error.code, message: result.error.message, details: result.error.details } }
        if (!accepts(result.value)) return { ok: false, error: { code: 'gateway/internal', message: 'Unexpected document read response', details: { path } } }
        return { ok: true, value: result.value }
      } finally {
        signal.removeEventListener('abort', cancel)
        operation.dispose()
      }
    } catch (error) {
      if (signal.aborted) return aborted()
      return { ok: false, error: { code: 'workspace-file/read-failed', message: error instanceof Error ? error.message : String(error), details: { path } } }
    }
  }
  return {
    readPage: (sessionId, path, offset, signal) => read(sessionId, path, { kind: 'text', offset }, signal, (value): value is WorkspaceFileText => 'text' in value),
    readAll: (file, signal) => read(file.sessionId, file.path, { kind: 'all' }, signal, (value): value is WorkspaceFileBytes => 'data' in value),
  }
}
