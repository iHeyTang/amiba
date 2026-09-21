import type { WorkspaceFileObservation, WorkspaceFileStat, WorkspaceFilesAdapter } from '@amiba/app-runtime/platform'
import type { RuntimeProvider } from './resources.js'
import { parseFileAddress } from './file-address.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap { file: WorkspaceFileStat }
}

/** Decorate the official provider, leaving reads, versions and permissions to
 * DSH. Native events only invalidate its stream: reopening takes a fresh DSH
 * stat and keeps the official change feed. No directory traversal or polling.
 * The registry opens this adapter only while an address has subscribers/pins.
 */
export function observeFileResource(
  provider: RuntimeProvider,
  observe: NonNullable<WorkspaceFilesAdapter['observe']>,
): RuntimeProvider {
  return {
    protocol: provider.protocol,
    async *open(address, { signal }) {
      const parsed = parseFileAddress(address)
      if (!parsed || parsed.scope !== 'session') { yield* provider.open(address, { signal }); return }
      let observation: WorkspaceFileObservation | undefined
      let target: string | undefined
      let cycle: AbortController | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let wake: (() => void) | undefined
      let invalidated = false
      let previous: string | undefined
      const invalidate = () => {
        if (signal.aborted || timer) return
        timer = setTimeout(() => {
          timer = undefined
          invalidated = true
          cycle?.abort()
          wake?.()
        }, 50)
      }
      const disposeObservation = () => {
        const current = observation
        observation = undefined
        current?.dispose()
      }
      const watch = (path: string) => {
        if (path === target || signal.aborted) return
        target = path
        disposeObservation()
        try {
          const current = observe(parsed.sessionId, path, invalidate)
          observation = current
          void current.ready.then(() => {
            // Close the gap between the initial official stat and watcher
            // readiness. One recheck, even if that gap contained no event.
            if (observation === current) invalidate()
          }, () => {
            // Native workspace scope may be narrower than DSH read scope.
            // Failure to watch must never replace the official read result.
            if (observation === current) disposeObservation()
          })
        } catch { disposeObservation() }
      }
      const abort = () => { clearTimeout(timer); cycle?.abort(); disposeObservation(); wake?.() }
      signal.addEventListener('abort', abort, { once: true })
      try {
        while (!signal.aborted) {
          invalidated = false
          cycle = new AbortController()
          try {
            for await (const frame of provider.open(address, { signal: cycle.signal })) {
              if (signal.aborted || cycle.signal.aborted) break
              const value = frame.ok ? frame.value as WorkspaceFileStat | undefined : undefined
              watch(value?.absolutePath ?? target ?? parsed.path)
              const identity = JSON.stringify(frame)
              if (identity !== previous) { previous = identity; yield frame }
            }
          } catch (error) {
            if (!cycle.signal.aborted) throw error
          }
          if (signal.aborted) return
          if (!invalidated) await new Promise<void>(resolve => { wake = resolve })
          wake = undefined
        }
      } finally {
        signal.removeEventListener('abort', abort)
        abort()
      }
    },
  }
}
