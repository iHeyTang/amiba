// @vitest-environment jsdom
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createResourceSnapshotStore } from '../resources/snapshot-store.js'
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { bindSnapshotSelector, keyedObservableHook } from '../../dev/renderer-bindings.js'
import { NativeSidebarSeat, SIDEBAR_PANEL, type NativeSidebarSeatProps } from './native-seat.js'
import { createSidebarRightController } from './service.js'
import { SidebarRightTabRegistry } from './tab-registry.js'
import { createSidebarRightSessionStore } from './session-store.js'
import { guideDefinition } from './tabs/guide/definition.js'
import type { TabId } from './dockkit/index.js'

afterEach(cleanup)
vi.mock('@deepseek-ai/dsh-client-runtime/client', async () => await import('../../dev/runtime-store.js'))

it('opens from an unmounted body, retains floats when collapsed, and restores native preview on removal', async () => {
  const sessionId = 'native-seat-session' as SessionId
  const tabs = new SidebarRightTabRegistry(new Context())
  tabs.register(guideDefinition(key => key))
  const { controller, adopt } = createSidebarRightController(tabs, vi.fn())
  const owner = createSidebarRightSessionStore(() => ({ kind: 'guide', title: 'Guide' }), adopt)
  const instance = owner.store.create(sessionId)
  const useStore = bindSnapshotSelector(instance)
  const useTabTypes = bindSnapshotSelector({ subscribe: fn => tabs.subscribe(fn), getSnapshot: () => tabs.entries() })
  const useTabNavigation = keyedObservableHook(key => controller.tabDomain.occurrence(sessionId, { id: key as TabId }).navigation)
  let mounts = 0
  function Probe() { useEffect(() => { mounts++ }, []); return <output>Retained body</output> }
  const panelInfo = createResourceSnapshotStore({ activePanelId: null as string | null })
  const common = {
    usePanelInfo: bindSnapshotSelector(panelInfo),
    sessionId, useStore, actions: instance.actions, useTabTypes, useTabNavigation,
    t: (key: string) => key,
    renderSlot: (_name: string, _owner: unknown, options?: { fallback?: unknown }) => _name === 'sidebar.right.pane.tab' ? <Probe /> : options?.fallback ?? null,
    bindService: (binding: Parameters<typeof controller.bind>[0]) => controller.bind(binding),
    openTab: controller.openTab.bind(controller),
    occurrence: (tab: { id: TabId }) => controller.tabDomain.occurrence(sessionId, tab),
    reportRoom: vi.fn(),
  }
  let remove: () => void = () => {}
  let restoreConversation: () => void = () => {}
  function Host() {
    const [activePanel, setActivePanel] = useState<string | null>(null)
    const [enabled, setEnabled] = useState(true)
    const visible = useSyncExternalStore(panelInfo.subscribe, panelInfo.getSnapshot).activePanelId === null
    remove = () => setEnabled(false)
    restoreConversation = () => { setActivePanel(null); panelInfo.set({ activePanelId: null }) }
    const props = { ...common, activePanel, openPanel: setActivePanel, closePanel: (id: string) => setActivePanel(current => current === id ? null : current) } as unknown as NativeSidebarSeatProps
    return <>{visible && enabled && <NativeSidebarSeat {...props} placement="tab" />}
      {!visible ? <article>Global page</article> : activePanel === SIDEBAR_PANEL ? enabled && <NativeSidebarSeat {...props} placement="content" /> : <article>Original preview</article>}</>
  }
  render(<Host />)
  expect(screen.getByText('Original preview')).toBeTruthy()
  act(() => controller.openTab('guide'))
  expect(screen.queryByText('Original preview')).toBeNull()
  expect(controller.isExpanded()).toBe(true)
  expect(mounts).toBe(1)
  act(() => instance.actions.setMode(sessionId, 'fullscreen'))
  expect(screen.getByText('Retained body')).toBeTruthy()
  act(() => instance.actions.setMode(sessionId, 'push'))
  expect(mounts).toBe(1)
  const tab = Object.values(instance.getSnapshot().bySession[sessionId]!.layout.tabs)[0]!
  const occurrence = controller.tabDomain.occurrence(sessionId, tab)
  act(() => controller.float(tab.id))
  expect(document.querySelector('[data-sidebar-right-float-host]')).toBeTruthy()
  const saved = instance.getSnapshot()
  await act(async () => { panelInfo.set({ activePanelId: 'global-tools' }); await Promise.resolve() })
  expect(document.querySelector('[data-sidebar-right-float-host]')).toBeNull()
  expect(document.querySelector('[data-sidebar-right-native]')).toBeNull()
  expect(controller.isExpanded()).toBe(false)
  expect(() => controller.openTab('guide')).toThrow('no session surface is mounted')
  expect(instance.getSnapshot()).toBe(saved)
  expect(occurrence.signal.aborted).toBe(false)
  act(restoreConversation)
  expect(document.querySelector('[data-sidebar-right-native]')).toBeTruthy()
  expect(controller.isExpanded()).toBe(true)
  expect(document.querySelector('[data-sidebar-right-float-host]')).toBeTruthy()
  expect(instance.getSnapshot()).toBe(saved)
  act(() => controller.toggleExpanded())
  expect(screen.getByText('Original preview')).toBeTruthy()
  expect(document.querySelector('[data-sidebar-right-float-host]')).toBeTruthy()
  expect(occurrence.signal.aborted).toBe(false)
  act(() => controller.toggleExpanded())
  await act(async () => { remove(); await Promise.resolve() })
  expect(screen.getByText('Original preview')).toBeTruthy()
  expect(document.querySelector('[data-sidebar-right-float-host]')).toBeNull()
  expect(controller.isExpanded()).toBe(false)
  owner.dispose()
  controller.tabDomain.dispose()
  expect(occurrence.signal.aborted).toBe(true)
})

it('restores the selected session without collapsing its store or retargeting old tab callbacks', async () => {
  const a = 'native-a' as SessionId, b = 'native-b' as SessionId
  const tabs = new SidebarRightTabRegistry(new Context())
  tabs.register(guideDefinition(key => key))
  tabs.register({ id: 'test/notes', kind: 'notes', title: () => 'Notes' })
  const { controller, adopt } = createSidebarRightController(tabs, vi.fn())
  const owner = createSidebarRightSessionStore(() => ({ kind: 'guide', title: 'Guide' }), adopt)
  const stores = { [a]: owner.store.create(a), [b]: owner.store.create(b) }
  for (const id of [a, b]) stores[id]!.actions.setExpanded(id, true)
  const panelInfo = createResourceSnapshotStore({ activePanelId: null as string | null })
  const usePanelInfo = bindSnapshotSelector(panelInfo)
  const useTabTypes = bindSnapshotSelector({ subscribe: fn => tabs.subscribe(fn), getSnapshot: () => tabs.entries() })
  const faces = Object.fromEntries([a, b].map(sessionId => [sessionId, {
    sessionId, usePanelInfo, useTabTypes, useStore: bindSnapshotSelector(stores[sessionId]!), actions: stores[sessionId]!.actions,
    useTabNavigation: keyedObservableHook(key => controller.tabDomain.occurrence(sessionId, { id: key as TabId }).navigation),
    occurrence: (tab: { id: TabId }) => controller.tabDomain.occurrence(sessionId, tab),
    bindService: (binding: Parameters<typeof controller.bind>[0]) => controller.bind(binding),
    openTab: controller.openTab.bind(controller), reportRoom: vi.fn(), t: (key: string) => key,
    renderSlot: () => null,
  }]))
  let select: (id: SessionId) => void = () => {}
  let selectRuntime: (id: SessionId) => void = () => {}
  function Host() {
    const [sessionId, setSessionId] = useState(a)
    const [workbenchSessionId, setWorkbenchSessionId] = useState(a)
    const [modes, setModes] = useState<Record<string, string | null>>({})
    selectRuntime = setSessionId
    select = id => { setSessionId(id); setWorkbenchSessionId(id) }
    const props = { ...faces[sessionId], workbenchSessionId, placement: 'tab', activePanel: modes[sessionId] ?? null,
      openPanel: (id: string) => setModes(previous => ({ ...previous, [sessionId]: id })),
      closePanel: (id: string) => setModes(previous => previous[sessionId] === id ? { ...previous, [sessionId]: null } : previous),
    } as unknown as NativeSidebarSeatProps
    return <><NativeSidebarSeat {...props} /><output data-selected>{sessionId}:{modes[sessionId] ?? 'preview'}</output></>
  }
  render(<Host />)
  const aTab = Object.values(stores[a]!.getSnapshot().bySession[a]!.layout.tabs)[0]!
  const old = controller.tabDomain.occurrence(a, aTab)
  const bBefore = stores[b]!.getSnapshot()
  await act(async () => { selectRuntime(b) })
  expect(controller.isExpanded()).toBe(false)
  expect(() => controller.openTab('notes')).toThrow('no session surface is mounted')
  expect(stores[b]!.getSnapshot()).toBe(bBefore)
  await act(async () => { select(b) })
  expect(document.querySelector('[data-selected]')?.textContent).toBe(`${b}:${SIDEBAR_PANEL}`)
  expect(stores[b]!.getSnapshot()).toBe(bBefore)
  act(() => old.tabActions.openTab('notes'))
  expect(stores[b]!.getSnapshot()).toBe(bBefore)
  expect(Object.values(stores[a]!.getSnapshot().bySession[a]!.layout.tabs).some(tab => tab.kind === 'notes')).toBe(true)
  expect(old.signal.aborted).toBe(false)
  await act(async () => { select(a) })
  expect(document.querySelector('[data-selected]')?.textContent).toBe(`${a}:${SIDEBAR_PANEL}`)
  expect(controller.isExpanded()).toBe(true)
  cleanup()
  owner.dispose()
  controller.tabDomain.dispose()
})
