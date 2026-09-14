// @vitest-environment jsdom
// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
/** Tab information refuses readers whose committed record and navigation binding disagree. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { bindSnapshotSelector } from '../../dev/renderer-bindings.js'
import { keyedObservableHook } from '../../dev/renderer-bindings.js'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from './dockkit/index.js'
import type { UseSidebarRightTabInfo } from './contract/slots.js'
import { createSidebarRightStore } from './stores.js'
import { TabDomain, type TabOccurrence } from './tab-domain.js'
import { tabInfoFactory, type TabHookContext } from './tab-info.js'

const SESSION = 's-info' as SessionId
const ADDRESS = 'dsh-resource://file/session/s-info/a.txt'
const domains: TabDomain[] = []

afterEach(() => {
  cleanup()
  for (const domain of domains.splice(0)) domain.dispose()
})

function harness() {
  const instance = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()
  const domain = new TabDomain({ openResourceIn: vi.fn(), openTabIn: vi.fn(), closeIn: vi.fn() }, vi.fn())
  domains.push(domain)
  const navigationSources = new Map<string, TabOccurrence['navigation']>()
  const useStore = bindSnapshotSelector(instance)
  // The renderer erases the keyed snapshot type; this family contains only tab navigation sources.
  const useTabNavigation = keyedObservableHook(key => navigationSources.get(key)) as TabHookContext['useTabNavigation']
  // Only sessionId is read from the standard share by this internal factory.
  const standard = { sessionId: SESSION } as Parameters<typeof tabInfoFactory>[0]
  const layout = () => instance.getSnapshot().bySession[SESSION]?.layout
  const sync = (): void => {
    const committed = layout()
    if (committed === undefined) throw new Error('expected the layout to commit')
    domain.sync(SESSION, committed)
  }
  const bind = (tabId: TabId, options: { title?: boolean; fullscreen?: boolean } = {}): UseSidebarRightTabInfo => {
    const occurrence = domain.occurrence(SESSION, { id: tabId })
    navigationSources.set(tabId, occurrence.navigation)
    return tabInfoFactory(standard, {
      tabId, title: options.title ?? false, fullscreen: options.fullscreen ?? false, signal: occurrence.signal, actions: occurrence.tabActions, useStore, useTabNavigation,
    })
  }
  const open = (beforeCommit?: (tabId: TabId) => void): TabId => {
    let opened: TabId | undefined
    instance.actions.openContent(SESSION, { kind: 'text', contentId: ADDRESS, title: 'a' }, (tabId) => {
      opened = tabId
      domain.navigate(SESSION, tabId, { address: ADDRESS, params: undefined })
      beforeCommit?.(tabId)
    })
    if (opened === undefined) throw new Error('expected the tab to open')
    sync()
    return opened
  }
  return { instance, domain, navigationSources, layout, sync, bind, open }
}

function expectUncommitted(useTabInfo: UseSidebarRightTabInfo, tabId: TabId): void {
  const message = `sidebarRight: tab "${tabId}" is not committed in session "${SESSION}"`
  const suppressExpected = (event: ErrorEvent): void => {
    if (event.error instanceof Error && event.error.message === message) event.preventDefault()
  }
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  window.addEventListener('error', suppressExpected)
  try {
    expect(() => renderHook(useTabInfo)).toThrow(message)
  } finally {
    window.removeEventListener('error', suppressExpected)
    report.mockRestore()
  }
}

describe('tabInfoFactory committed-record relation', () => {
  it('tracks active bodies, inactive titles, collapsed panes and floating tabs through real store hooks', () => {
    const h = harness();
    const first = h.open();
    const body = renderHook(h.bind(first));
    const title = renderHook(h.bind(first, { title: true }));
    const signal = body.result.current.tab.signal;
    const actions = body.result.current.tab.actions;
    const dockPane = body.result.current.panel.id;
    expect(body.result.current.tab.visible).toBe(true);
    act(() => { h.instance.actions.duplicateTab(SESSION, first); h.sync(); });
    expect(body.result.current.tab.visible).toBe(false);
    expect(title.result.current.tab.visible).toBe(true);
    act(() => { h.instance.actions.setExpanded(SESSION, false); h.sync(); });
    expect(title.result.current.tab.visible).toBe(false);
    expect(signal.aborted).toBe(false);
    act(() => { h.instance.actions.floatTab(SESSION, first); h.sync(); });
    expect(body.result.current.tab.visible).toBe(true);
    expect(body.result.current.panel.id).not.toBe(dockPane);
    expect(body.result.current.tab.signal).toBe(signal);
    expect(body.result.current.tab.actions).toBe(actions);
    const fullscreen = renderHook(h.bind(first, { fullscreen: true }));
    expect(fullscreen.result.current.sidebar.fullscreen).toBe(true);
  });

  it('rejects a navigation before the first layout commit and reads the same record after commit', () => {
    const h = harness()
    const tabId = h.open((opened) => {
      expect(h.layout()).toBeUndefined()
      expectUncommitted(h.bind(opened), opened)
    })
    const view = renderHook(h.bind(tabId))
    expect(view.result.current.tab).toMatchObject({ id: tabId, contentId: ADDRESS })
    expect(view.result.current.tab.signal.aborted).toBe(false)
    expect(view.result.current.tab.navigation.revision).toBe(1)
  })

  it('rejects a retained reader after its record closes, even while its navigation snapshot is held', () => {
    const h = harness()
    const tabId = h.open()
    const useTabInfo = h.bind(tabId)
    const view = renderHook(useTabInfo)
    const { signal, navigation } = view.result.current.tab
    view.unmount()

    h.instance.actions.closeTab(SESSION, tabId)
    h.sync()

    expect(signal.aborted).toBe(true)
    expect(h.layout()?.tabs[tabId]).toBeUndefined()
    expect(h.navigationSources.get(tabId)?.getSnapshot()).toBe(navigation)
    expectUncommitted(useTabInfo, tabId)
  })

  it('rejects a retained record after its keyed navigation binding is released', () => {
    const h = harness()
    const tabId = h.open()
    const useTabInfo = h.bind(tabId)
    const view = renderHook(useTabInfo)
    expect(view.result.current.tab.id).toBe(tabId)
    view.unmount()
    const committed = h.layout()

    h.domain.dispose()
    h.navigationSources.clear()

    expect(h.layout()).toBe(committed)
    expect(h.layout()?.tabs[tabId]).toBeDefined()
    expectUncommitted(useTabInfo, tabId)
  })
})

vi.mock('@deepseek-ai/dsh-client-runtime/client', async () => await import('../../dev/runtime-store.js'));
