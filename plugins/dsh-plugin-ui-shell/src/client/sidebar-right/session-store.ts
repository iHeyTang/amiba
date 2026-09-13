import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSidebarRightStore } from './stores.js'
import type { SidebarRightSeed } from './contract/seed.js'
import type { SidebarRightSurfaceStore } from './service.js'

/** Share one handle between the panel and header; the slot runtime owns its instances. */
export function createSidebarRightSessionStore(
  seed: () => SidebarRightSeed,
  adopt: (sessionId: SessionId, instance: SidebarRightSurfaceStore) => () => void,
): { store: ReturnType<typeof createSidebarRightStore>; dispose(): void } {
  const handle = createSidebarRightStore(seed)
  const releases: Array<() => void> = []
  let disposed = false
  return {
    store: {
      ...handle,
      create(scopeKey) {
        if (disposed) throw new Error('sidebarRight: session store owner is disposed')
        const instance = handle.create(scopeKey)
        if (scopeKey !== undefined) releases.push(adopt(scopeKey as SessionId, instance))
        return instance
      },
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const release of releases) release()
      releases.length = 0
    },
  }
}
