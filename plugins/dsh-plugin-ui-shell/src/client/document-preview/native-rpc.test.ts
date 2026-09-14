import { expect, it, vi } from 'vitest'
import { nativeDocumentReads } from './native-rpc.js'
import type { WorkspaceDocumentReadResult } from '@amiba/app-runtime/platform'
import { FILE } from './fixtures.js'
it('passes the addressed session, exact window and typed failures, releasing each operation', async () => {
  const dispose = vi.fn()
  const readDocument = vi.fn().mockReturnValue({ result: Promise.resolve({ ok: true, value: { absolutePath: '/file', version: 'v1', offset: 1, text: 'hello', lines: 1, eof: true } }), dispose })
  const reads = nativeDocumentReads({ readDocument })
  const signal = new AbortController().signal
  const result = await reads.readPage(FILE.sessionId, FILE.path, 1, signal)
  expect(readDocument).toHaveBeenCalledWith(FILE.sessionId, FILE.path, { kind: 'text', offset: 1 })
  expect(result.ok).toBe(true)
  expect(dispose).toHaveBeenCalledTimes(1)
  readDocument.mockReturnValue({ result: Promise.resolve({ ok: false, error: { name: 'Error', code: 'workspace-file/too-large', message: 'large', details: { limit: 32 } } }), dispose })
  expect(await reads.readAll(FILE, signal)).toEqual({ ok: false, error: { code: 'workspace-file/too-large', message: 'large', details: { limit: 32 } } })
  expect(readDocument).toHaveBeenLastCalledWith(FILE.sessionId, FILE.path, { kind: 'all' })
})
it('aborts native work and ignores success arriving after the owning signal ends', async () => {
  let finish!: (result: WorkspaceDocumentReadResult) => void
  const dispose = vi.fn(), readDocument = vi.fn(() => ({ result: new Promise<WorkspaceDocumentReadResult>(resolve => { finish = resolve }), dispose }))
  const reads = nativeDocumentReads({ readDocument })
  const controller = new AbortController()
  const result = reads.readAll(FILE, controller.signal)
  controller.abort()
  expect(dispose).toHaveBeenCalledTimes(1)
  finish({ ok: true, value: { absolutePath: '/file', version: 'v1', offset: 0, data: '', eof: true } })
  expect(await result).toMatchObject({ ok: false, error: { code: 'ABORT_ERR' } })
  const before = readDocument.mock.calls.length
  expect(await reads.readAll(FILE, controller.signal)).toMatchObject({ ok: false, error: { code: 'ABORT_ERR' } })
  expect(readDocument).toHaveBeenCalledTimes(before)
})
it('returns failures rather than rejecting on unavailable hosts, transport faults and wrong response shapes', async () => {
  const signal = new AbortController().signal
  expect(await nativeDocumentReads({}).readAll(FILE, signal)).toMatchObject({ ok: false, error: { code: 'workspace-file/unsupported' } })
  const dispose = vi.fn()
  const reads = nativeDocumentReads({ readDocument: () => ({ result: Promise.reject(new Error('disconnected')), dispose }) })
  expect(await reads.readAll(FILE, signal)).toMatchObject({ ok: false, error: { code: 'workspace-file/read-failed', message: 'disconnected' } })
  expect(dispose).toHaveBeenCalledTimes(1)
  const wrong = nativeDocumentReads({ readDocument: () => ({ result: Promise.resolve({ ok: true, value: { absolutePath: '/file', version: 'v1', offset: 0, data: '', eof: true } }), dispose }) })
  expect(await wrong.readPage(FILE.sessionId, FILE.path, 1, signal)).toMatchObject({ ok: false, error: { code: 'gateway/internal' } })
})
