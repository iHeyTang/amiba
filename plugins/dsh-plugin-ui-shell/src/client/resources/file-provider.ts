import type { WorkspaceFileStat, WorkspaceFilesAdapter } from '@amiba/app-runtime/platform'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ResourceProvider } from './contract.js'
import { parseFileAddress } from './file-address.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap { file: WorkspaceFileStat }
}

/** rc.2 has no official workspaceFiles change feed. Reconcile metadata only
 * while held, including absent files, default HOME and tree-ignored folders.
 * This is snapshot compatibility, not delivery of every intermediate write.
 */
export function createFileResourceProvider(
  files: Pick<WorkspaceFilesAdapter, 'stat'>,
  intervalMs = 1000,
): ResourceProvider<'file'> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('Invalid file reconciliation interval');
  return {
    protocol: 'file',
    async *open(address, { signal }) {
      if (signal.aborted) return;
      const parsed = parseFileAddress(address);
      if (!parsed || parsed.scope !== 'session') {
        yield failure(parsed ? 'workspace-file/unknown-workspace' : 'workspace-file/unsupported-address',
          parsed ? 'A session-scoped file address is required.' : 'Unsupported file resource address.', { address });
        return;
      }
      if (!files.stat) {
        yield failure('workspace-file/unavailable', 'This platform does not provide file metadata.', { address });
        return;
      }
      let previous: string | undefined;
      while (!signal.aborted) {
        let frame: RemoteResult<WorkspaceFileStat>;
        try {
          frame = { ok: true, value: await files.stat(parsed.sessionId, parsed.path) };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Electron preserves the main error message, but not custom properties.
          const code = /\bENOENT\b/.test(message) ? 'workspace-file/not-found'
            : message.includes('not a file') ? 'workspace-file/not-regular-file'
            : 'workspace-file/read-failed';
          frame = failure(code, message, { path: parsed.path });
        }
        if (signal.aborted) return;
        const identity = JSON.stringify(frame);
        if (identity !== previous) {
          previous = identity;
          yield frame;
        }
        if (signal.aborted) return;
        await delay(intervalMs, signal);
      }
    },
  };
}

function failure(code: string, message: string, details: object): { ok: false; error: RemoteFailure } {
  return { ok: false, error: { code, message, details } };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}
