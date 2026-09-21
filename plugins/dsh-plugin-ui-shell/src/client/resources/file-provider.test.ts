import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeFileResource } from './file-provider.js'
import type { WorkspaceFilesAdapter } from '@amiba/app-runtime/platform'
import { ResourceRegistry, type RuntimeProvider } from './resources.js'
import { Context } from '@deepseek-ai/cordis'
import type { ResourceResult } from './result.js'

afterEach(() => vi.useRealTimers())
const address = 'dsh-resource://file/session/s%201/a.txt'
const value = { absolutePath: '/workspace/a.txt', version: 'dsh-v1', bytes: 4 }
function harness() {
  let current: ResourceResult<unknown> = { ok: true, value }
  let changed!: () => void
  let ready!: () => void
  const dispose = vi.fn()
  const observe = vi.fn((_id: string, _path: string, callback: () => void) => {
    changed = callback
    return { ready: new Promise<void>(r => { ready = r }), dispose }
  })
  const signals: AbortSignal[] = []
  let push!: (frame: ResourceResult<unknown>) => void
  const provider: RuntimeProvider = { protocol: 'file', async *open(_address, { signal }) {
    signals.push(signal)
    let wake!: () => void
    const queue: ResourceResult<unknown>[] = []
    push = frame => { queue.push(frame); wake?.() }
    const abort = () => wake?.()
    signal.addEventListener('abort', abort)
    try {
      yield current
      while (!signal.aborted) {
        if (!queue.length) await new Promise<void>(r => { wake = r })
        while (queue.length && !signal.aborted) yield queue.shift()!
      }
    } finally { signal.removeEventListener('abort', abort) }
  } }
  const controller = new AbortController()
  const frames: ResourceResult<unknown>[] = []
  const start = (watch: NonNullable<WorkspaceFilesAdapter['observe']> = observe) => (async () => {
    for await (const frame of observeFileResource(provider, watch).open(address, controller)) frames.push(frame)
  })()
  return { controller, frames, signals, dispose, observe, start,
    ready: () => ready(), changed: () => changed(), push: (frame: ResourceResult<unknown>) => push(frame),
    set current(frame: ResourceResult<unknown>) { current = frame } }
}

describe('official provider with on-demand native invalidation', () => {
  it('rechecks the readiness gap, coalesces edits and retains official versions without idle polling', async () => {
    vi.useFakeTimers()
    const h = harness(); const job = h.start()
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(h.observe).toHaveBeenCalledWith('s 1', '/workspace/a.txt', expect.any(Function))
      h.ready(); await vi.advanceTimersByTimeAsync(50)
      expect(h.signals).toHaveLength(2); expect(h.frames).toEqual([{ ok: true, value }])
      await vi.advanceTimersByTimeAsync(60_000); expect(h.signals).toHaveLength(2)
      h.current = { ok: true, value: { ...value, version: 'dsh-v2', bytes: 9 } }
      h.changed(); h.changed(); h.changed(); await vi.advanceTimersByTimeAsync(50)
      expect(h.signals).toHaveLength(3); expect(h.frames.at(-1)).toEqual({ ok: true, value: { ...value, version: 'dsh-v2', bytes: 9 } })
      // An official instrumented write still travels through the same stream.
      h.push({ ok: true, value: { ...value, version: 'dsh-v3' } }); await vi.advanceTimersByTimeAsync(0)
      expect(h.frames.at(-1)).toMatchObject({ value: { version: 'dsh-v3' } })
    } finally { h.controller.abort(); await job }
    expect(h.dispose).toHaveBeenCalledTimes(1); expect(h.signals.every(x => x.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers after external deletion and recreation, and cancels pending invalidations', async () => {
    vi.useFakeTimers()
    const h = harness(); const job = h.start()
    try {
      await vi.advanceTimersByTimeAsync(0); h.ready(); await vi.advanceTimersByTimeAsync(50)
      h.current = { ok: false, error: { code: 'workspace-file/not-found', message: 'absent', details: {} } }
      h.changed(); await vi.advanceTimersByTimeAsync(50)
      expect(h.frames.at(-1)).toMatchObject({ ok: false })
      h.current = { ok: true, value: { ...value, version: 'recreated' } }
      h.changed(); await vi.advanceTimersByTimeAsync(50)
      expect(h.frames.at(-1)).toMatchObject({ value: { version: 'recreated' } })
      h.changed()
    } finally { h.controller.abort(); await job }
    const count = h.frames.length
    await vi.advanceTimersByTimeAsync(100); expect(h.frames).toHaveLength(count)
    expect(h.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps official previews working when native observation is unavailable or outside workspace scope', async () => {
    const h = harness()
    const job = h.start(() => ({ ready: Promise.reject(new Error('outside workspace')), dispose: h.dispose }))
    try {
      await new Promise(r => setTimeout(r, 0))
      expect(h.frames).toEqual([{ ok: true, value }]); expect(h.dispose).toHaveBeenCalledTimes(1)
      h.push({ ok: true, value: { ...value, version: 'official-v2' } })
      await new Promise(r => setTimeout(r, 0))
      expect(h.frames.at(-1)).toMatchObject({ value: { version: 'official-v2' } })
    } finally { h.controller.abort(); await job }
  })
})


it('opens only while held, shares subscribers and releases after the last pin', async () => {
  vi.useFakeTimers()
  const dispose = vi.fn()
  const observe = vi.fn(() => ({ ready: Promise.resolve(), dispose }))
  const ctx = new Context()
  const registry = new ResourceRegistry(ctx, observe)
  const signals: AbortSignal[] = []
  const release = registry.register({ protocol: 'file', async *open(_address, { signal }) {
    signals.push(signal)
    yield { ok: true, value }
    if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
  } })
  const source = registry.source(address)
  expect(observe).not.toHaveBeenCalled()
  const first = source.subscribe(() => {})
  const second = source.subscribe(() => {})
  const pin = new AbortController(); registry.pin(address, pin.signal)
  await vi.advanceTimersByTimeAsync(50)
  expect(observe).toHaveBeenCalledTimes(1)
  first(); second(); expect(dispose).not.toHaveBeenCalled()
  pin.abort(); await vi.advanceTimersByTimeAsync(0)
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(signals.every(s => s.aborted)).toBe(true)
  expect(source.getSnapshot().status).toBe('loading')
  release()
})

it('cancels observation while readiness is pending without opening another stream', async () => {
  vi.useFakeTimers()
  const h = harness(); const job = h.start()
  await vi.advanceTimersByTimeAsync(0)
  h.controller.abort(); await job
  h.ready(); await vi.advanceTimersByTimeAsync(100)
  expect(h.signals).toHaveLength(1)
  expect(h.dispose).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
