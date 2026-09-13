// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { Maximize2, Minimize2, PanelRightClose } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from './contract/slots.js'
import type { DockIntents, FloatRect, TabId, TabRecord, TabRenderer, HalvesFit, LayoutState, PaneId } from './dockkit/index.js'
import { canSplit, findPaneContentTab } from './dockkit/index.js'
import { DockSurface, FloatLayer } from './dockkit/react.js'
import { GUIDE_KIND, pageAddress } from './contract/seed.js'
import { dockLabels } from './labels.js'
import type { SidebarRightBinding, SidebarRightOpenTabOptions } from './service.js'
import type { SidebarRightTabDefinition } from './tab-registry.js'
import { canCloseTab, type createSidebarRightStore, type SurfaceState } from './stores.js'
import type { TabOccurrence } from './tab-domain.js'
import type { SidebarRightTabNavigation } from './contract/slots.js'
import type { TabHookContext } from './tab-info.js'

type Store = PropsStore<ReturnType<typeof createSidebarRightStore>>
type Children = PropsRenderSlots<'sidebar.right.pane.tab' | 'sidebar.right.pane.tab.title' | 'sidebar.right.tab.menu.item'>
export interface SidebarRightInjected {
  /** Shared per-session destination; the tab owns its React tree while content places it. */
  dockHost: HTMLDivElement
  reportRoom(fits: ReadonlyMap<PaneId, HalvesFit>): void
  bindService(binding: SidebarRightBinding): () => void
  openTab(kind: string, options?: SidebarRightOpenTabOptions): void
  hooks: { tabTypes: HostObservable<readonly SidebarRightTabDefinition[]> }
  keyedHooks: { tabNavigation(key: string): HostObservable<SidebarRightTabNavigation> }
  occurrence(tab: Pick<TabRecord, 'id'>): TabOccurrence
}
export type NativeSidebarSeatProps = PropsRuntime<'amiba.workbench.panel'> & Children & Store & PropsLocale<'sidebarRight'> & InjectFace<SidebarRightInjected>
export const SIDEBAR_PANEL = 'dsh-sidebar-right'
const panelTypography = { '--dsh-content-font-size-secondary': '12px', fontSize: '12px' } as CSSProperties
const chromeButton = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/45 hover:text-foreground'
/** Everything the panel needs, already bound to one session. */
interface PanelProps {
  readonly sessionId: SessionId
  readonly surface: SurfaceState
  readonly actions: Store['actions']
  readonly t: PropsLocale<'sidebarRight'>['t']
  readonly renderSlot: Children['renderSlot']
  readonly openTab: SidebarRightInjected['openTab']
  readonly useTabTypes: InjectFace<SidebarRightInjected>['useTabTypes']
  readonly useTabNavigation: InjectFace<SidebarRightInjected>['useTabNavigation']
  readonly useStore: Store['useStore']
  readonly occurrence: SidebarRightInjected['occurrence']
  readonly fullscreen: boolean
  readonly autoFullscreen: boolean
  /** Receives the kit's room-rule readings for the service's `split`. */
  readonly reportRoom: (fits: ReadonlyMap<PaneId, HalvesFit>) => void
}

/** The guide tab one pane holds, if any: a pane holds at most one. */
function guideIn(layout: LayoutState, paneId: PaneId): TabId | undefined {
  return findPaneContentTab(layout, paneId, pageAddress(GUIDE_KIND), GUIDE_KIND)
}

/**
 * Build the kit's intent face for one session out of the store's actions.
 * @param sessionId - the session the seat draws; every action is bound to it.
 * @param actions - the seat's bound store actions.
 * @param openTab - the navigation face's `openTab`, which the strip's add control asks for a guide through.
 * @returns the intents the kit reports gestures to.
 */
export function intentsFor(sessionId: SessionId, actions: Store['actions'], openTab: PanelProps['openTab']): DockIntents {
  return {
    focusTab: (tabId) => { actions.focusTab(sessionId, tabId) },
    focusPane: (paneId) => { actions.focusPane(sessionId, paneId) },
    splitPane: (paneId) => { actions.splitPane(sessionId, paneId) },
    // The guide is unique per pane: the control is drawn only while its pane
    // holds none (`canAddTab` below) and asks for one there without regard to
    // guides in other panes; the store settles the open on a guide the pane
    // already holds, so the ask is idempotent all the same.
    addTab: (paneId) => { openTab(GUIDE_KIND, { paneId, revealIfOpened: false }) },
    closeTab: (tabId) => { actions.closeTab(sessionId, tabId) },
    duplicateTab: (tabId) => { actions.duplicateTab(sessionId, tabId) },
    floatTab: (tabId, rect?: FloatRect) => { actions.floatTab(sessionId, tabId, rect) },
    unfloatPane: (paneId) => { actions.unfloatPane(sessionId, paneId) },
    placeTab: (tabId, toPaneId, index) => { actions.placeTab(sessionId, tabId, toPaneId, index) },
    dropTab: (tabId, paneId, zone) => { actions.dropTab(sessionId, tabId, paneId, zone) },
    moveFloat: (paneId, x, y) => { actions.moveFloat(sessionId, paneId, x, y) },
    resizeFloat: (paneId, rect) => { actions.resizeFloat(sessionId, paneId, rect) },
    resizeSplit: (splitId, sizes) => { actions.resizeSplit(sessionId, splitId, sizes) },
  }
}

/** One tab's slot dispatch: which seat, and what to render when no type registered. */
interface TabSlotProps extends Pick<PanelProps, 'renderSlot' | 'occurrence' | 'useTabTypes' | 'useTabNavigation' | 'useStore' | 'fullscreen'> {
  readonly tab: TabRecord
  readonly seat: 'sidebar.right.pane.tab' | 'sidebar.right.pane.tab.title'
  readonly fallback: ReactNode
}

/**
 * Dispatch one tab's body or title with stable framework hooks and record lifetime.
 */
function TabSlot({
  renderSlot, occurrence, useTabTypes, useTabNavigation, useStore, fullscreen, tab, seat, fallback,
}: TabSlotProps): ReactNode {
  const { signal, tabActions } = occurrence(tab)
  const definition = useTabTypes(types => types.find(definition => definition.kind === tab.kind))
  const hookContext = useMemo((): TabHookContext => ({
    tabId: tab.id,
    title: seat === 'sidebar.right.pane.tab.title',
    fullscreen,
    signal,
    actions: tabActions,
    useStore,
    useTabNavigation,
  }), [tab.id, seat, fullscreen, signal, tabActions, useStore, useTabNavigation])
  return renderSlot(seat, {}, { entryKey: definition?.id ?? tab.kind, fallback, hookContext })
}

/**
 * Dispatch a tab's body to its registered type.
 *
 * A kind with no registrant is a real state, not a defect: a session log can
 * carry a tab whose type shipped in a plugin that is no longer mounted. Saying so
 * is better than an empty pane.
 */
function bodiesFor(panel: PanelProps): TabRenderer {
  const { t, ...rest } = panel
  // Keyed by record: the kit draws one body per pane in one place, and the
  // keyed slot below keys on the type, so two tabs of one kind would otherwise
  // share a component instance and its local state (a scroll position, a ref).
  return tab => (
    <TabSlot
      key={tab.id}
      {...rest}
      tab={tab}
      seat="sidebar.right.pane.tab"
      fallback={<p className="p-3 text-xs text-muted-foreground" data-sidebar-right-unavailable>{t('tab.unavailable')}</p>}
    />
  )
}

/** Dispatch a tab's title to its registered type; without one the chip shows the title captured at open time. */
function titlesFor(panel: PanelProps): TabRenderer {
  return tab => <TabSlot key={tab.id} {...panel} tab={tab} seat="sidebar.right.pane.tab.title" fallback={tab.title} />
}


/** The tab occurrence binds the service; tab and content share the framework store. */
export function NativeSidebarSeat(props: NativeSidebarSeatProps): ReactNode {
  // The renderer can reuse an entry across session changes. Keep its React
  // state and tab bodies scoped to the same session as the framework store.
  if (props.workbenchSessionId !== undefined && props.workbenchSessionId !== props.sessionId) return null
  return <SessionSidebarSeat key={props.sessionId} {...props} />
}

function SessionSidebarSeat(props: NativeSidebarSeatProps): ReactNode {
  const { sessionId, useStore, usePanelInfo, actions, t, renderSlot, bindService, openTab, useTabTypes, useTabNavigation, occurrence, reportRoom, placement, activePanel, openPanel, closePanel } = props
  const conversationVisible = usePanelInfo(info => info.activePanelId === null)
  const surfaces = useStore(state => state.bySession)
  const surface = surfaces[sessionId]
  const active = activePanel === SIDEBAR_PANEL
  const expanded = surface?.layout.expanded ?? false
  const previous = useRef({ expanded, active, visible: false })
  const fullscreen = surface?.layout.mode === 'fullscreen'
  const anchor = useRef<HTMLDivElement>(null)
  const { dockHost } = props
  useLayoutEffect(() => {
    if (placement !== 'content') return
    const target = fullscreen && active ? document.body : anchor.current
    if (target) target.append(dockHost)
    return () => { dockHost.remove() }
  }, [conversationVisible, placement, fullscreen, active, dockHost])


  useEffect(() => {
    if (conversationVisible && placement === 'tab' && surface === undefined) actions.open(sessionId)
  }, [conversationVisible, placement, surface, actions, sessionId])
  useLayoutEffect(() => {
    if (!conversationVisible || placement !== 'tab') return
    return bindService({ sessionId, actions, surfaces, canSplitPane: () => true })
  }, [conversationVisible, placement, bindService, sessionId, actions, surfaces])
  useLayoutEffect(() => {
    if (placement !== 'tab') return
    const before = previous.current
    previous.current = { expanded, active, visible: conversationVisible }
    if (!conversationVisible) return
    if (!before.visible || expanded !== before.expanded) {
      if (expanded) openPanel(SIDEBAR_PANEL)
      else closePanel?.(SIDEBAR_PANEL)
    } else if (active !== before.active && active !== expanded) actions.setExpanded(sessionId, active)
  }, [conversationVisible, placement, expanded, active, openPanel, closePanel, actions, sessionId])
  const closeRef = useRef(closePanel)
  closeRef.current = closePanel
  const lifetime = useRef(0)
  useEffect(() => {
    const token = ++lifetime.current
    return () => { queueMicrotask(() => { if (placement === 'tab' && lifetime.current === token) closeRef.current?.(SIDEBAR_PANEL) }) }
  }, [placement, sessionId])
  if (!conversationVisible) return null
  const tabButton = <button type="button" role="tab" aria-selected={active}
    className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/45 hover:text-foreground aria-selected:bg-muted aria-selected:text-foreground"
    onClick={() => { actions.setExpanded(sessionId, true); openPanel(SIDEBAR_PANEL) }}>{t('chrome.expand')}</button>
  if (surface === undefined) return placement === 'tab' ? tabButton : null
  const panel: PanelProps = { sessionId, surface, actions, t, renderSlot, openTab, useTabTypes, useTabNavigation, useStore, occurrence, fullscreen, autoFullscreen: false, reportRoom }
  const intents = intentsFor(sessionId, actions, openTab)
  const content = <section data-sidebar-right-native hidden={!active} className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground" style={fullscreen ? { ...panelTypography, position: 'fixed', inset: 0, zIndex: 60 } : panelTypography}>
    <DockSurface state={surface.layout} canSplit={canSplit(surface.layout)} dropZones="horizontal" minPaneFraction={0.2}
      canAddTab={paneId => guideIn(surface.layout, paneId) === undefined} canCloseTab={tabId => canCloseTab(surface, tabId)}
      intents={intents} labels={dockLabels(t)} renderTab={bodiesFor(panel)} renderTabTitle={titlesFor(panel)}
      renderTabMenuItems={(tab, dismiss) => renderSlot('sidebar.right.tab.menu.item', { tab, dismiss })} onRoom={reportRoom}
      chrome={<><button type="button" className={chromeButton} data-sidebar-right-mode={fullscreen ? 'push' : 'fullscreen'} aria-label={t(fullscreen ? 'chrome.exitFullscreen' : 'chrome.toFullscreen')} title={t(fullscreen ? 'chrome.exitFullscreen' : 'chrome.toFullscreen')}
        onClick={() => actions.setMode(sessionId, fullscreen ? 'push' : 'fullscreen')}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button type="button" className={chromeButton} aria-label={t('chrome.collapse')} title={t('chrome.collapse')} onClick={() => actions.setExpanded(sessionId, false)}><PanelRightClose size={16} /></button></>} />
  </section>
  if (placement === 'tab') return <>{tabButton}{createPortal(content, dockHost)}
    {surface.layout.floats.length > 0 && createPortal(<div data-sidebar-right-float-host style={{...panelTypography,position:'fixed',inset:0,pointerEvents:'none',zIndex:61}}>
      <FloatLayer state={surface.layout} canCloseTab={tabId => canCloseTab(surface, tabId)} intents={intents} labels={dockLabels(t)} renderTab={bodiesFor(panel)} renderTabTitle={titlesFor(panel)} />
    </div>, document.body)}</>
  return <div ref={anchor} className="h-full min-h-0" />
}
