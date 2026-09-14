/** PDF view preferences survive body remounts without sharing state between tabs. */
import { describe, expect, it, vi } from 'vitest'
import type { TabId } from '../../sidebar-right/dockkit/index.js'
import { createPdfStore } from './store.js'

describe('PDF view store', () => {
  it('keeps the last visible page for each tab and forgets only the closed tab', () => {
    const instance = createPdfStore().create()
    const one = 'one' as TabId
    const two = 'two' as TabId
    instance.actions.page(one, 3)
    instance.actions.page(two, 2)
    expect(instance.getSnapshot().byTab).toEqual({ one: { page: 3 }, two: { page: 2 } })
    instance.actions.forget(one)
    expect(instance.getSnapshot().byTab).toEqual({ two: { page: 2 } })
  })

  it('creates independent Session store instances', () => {
    const store = createPdfStore()
    const first = store.create()
    const second = store.create()
    first.actions.page('same-tab' as TabId, 2)
    expect(second.getSnapshot().byTab).toEqual({})
  })
})
