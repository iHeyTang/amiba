// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '../sidebar-right/dockkit/index.js'
import type { WorkspaceFileText } from './wire.js'
import type { SessionFile } from './rpc.js'
export const TAB_ID = 'tab-1' as TabId
export const SESSION = 's-1' as SessionId
/** The path relative to the session's workspace root, as the Host receives it. */
export const PATH = 'work/notes.md'
export const ABSOLUTE_PATH = '/host/project/work/notes.md'
/** The tab's address: the file under this session's scope. */
export const ADDRESS = 'dsh-resource://file/session/s-1/work/notes.md'
/** What the address names, as the face receives it. */
export const FILE: SessionFile = { sessionId: SESSION, path: PATH }

/** One page the Host would return: the lines joined without a terminator, and their count. */
export function page(offset: number, lines: readonly string[], eof: boolean, version = 'v1'): RemoteResult<WorkspaceFileText> {
  return { ok: true, value: { absolutePath: ABSOLUTE_PATH, version, offset, text: lines.join('\n'), lines: lines.length, eof, bytes: 100 } }
}

/** One failed page read. */
export function failure(code: string, details: Record<string, unknown> = {}): RemoteResult<WorkspaceFileText> {
  return { ok: false, error: { code, message: 'boom', details } as unknown as RemoteFailure }
}

