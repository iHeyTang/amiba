import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { createSidebarRightSessionStore } from './session-store.js'
import { createSidebarRightController } from './service.js'
import { SidebarRightTabRegistry } from './tab-registry.js'

const a = 'session-a' as SessionId
const b = 'session-b' as SessionId
const seed = () => ({ kind: 'guide', title: 'Guide' })

describe('framework session store adoption', () => {
  it('adopts only scoped instances and releases each adoption exactly once', () => {
    const release = vi.fn()
    const adopt = vi.fn(() => release)
    const owner = createSidebarRightSessionStore(seed, adopt)
    owner.store.create()
    expect(adopt).not.toHaveBeenCalled()
    const first = owner.store.create(a)
    expect(adopt).toHaveBeenCalledWith(a, first)
    owner.dispose()
    owner.dispose()
    expect(release).toHaveBeenCalledTimes(1)
    expect(() => owner.store.create(b)).toThrow('disposed')
  })

  it('syncs resource lifetimes from the original session and stops observing on owner unload', () => {
    const tabs = new SidebarRightTabRegistry(new Context())
    tabs.register({ id: 'test/text', kind: 'text', patterns: ['dsh-resource://file/**'], priority: 'fallback', title: () => 'File' })
    const pin = vi.fn()
    const { controller, adopt } = createSidebarRightController(tabs, pin)
    const owner = createSidebarRightSessionStore(seed, adopt)
    const first = owner.store.create(a)
    const second = owner.store.create(b)
    first.actions.setExpanded(a, true)
    second.actions.setExpanded(b, true)
    const firstTab = Object.values(first.getSnapshot().bySession[a]!.layout.tabs)[0]!
    const secondTab = Object.values(second.getSnapshot().bySession[b]!.layout.tabs)[0]!
    const occurrence = controller.tabDomain.occurrence(a, firstTab)
    const other = controller.tabDomain.occurrence(b, secondTab)
    expect(occurrence.signal.aborted).toBe(false)
    expect(other.signal.aborted).toBe(false)
    const secondSnapshot = second.getSnapshot()
    occurrence.tabActions.openResource('dsh-resource://file/session-a/readme')
    expect(second.getSnapshot()).toBe(secondSnapshot)
    expect(Object.values(first.getSnapshot().bySession[a]!.layout.tabs).some(tab => tab.kind === 'text')).toBe(true)
    const resourceTab = Object.values(first.getSnapshot().bySession[a]!.layout.tabs).find(tab => tab.kind === 'text')!
    const resource = controller.tabDomain.occurrence(a, resourceTab)
    expect(pin).toHaveBeenCalledWith(resourceTab.contentId, resource.signal)
    const before = first.getSnapshot()
    owner.dispose()
    occurrence.tabActions.openResource('dsh-resource://file/session-a/readme')
    expect(first.getSnapshot()).toBe(before)
    first.actions.closeTab(a, resourceTab.id)
    expect(resource.signal.aborted).toBe(false)
    // Domain disposal is owned by the enclosing plugin, after seats release.
    controller.tabDomain.dispose()
    expect(occurrence.signal.aborted).toBe(true)
    expect(other.signal.aborted).toBe(true)
    expect(resource.signal.aborted).toBe(true)
  })
})

vi.mock('@deepseek-ai/dsh-client-runtime/client', async () => await import('../../dev/runtime-store.js'))
