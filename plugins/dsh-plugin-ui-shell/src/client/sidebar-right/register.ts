import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId, PaneId, HalvesFit } from './dockkit/index.js'
import { createSidebarRightController } from './service.js'
import type { SidebarRightTabRegistry } from './tab-registry.js'
import { createSidebarRightSessionStore } from './session-store.js'
import { defaultSeed } from './contract/seed.js'
import { NativeSidebarSeat, type SidebarRightInjected } from './native-seat.js'
import { tabInfoFactory, guideTabInfoFactory } from './tab-info.js'
import { guideDefinition, GUIDE_ID } from './tabs/guide/definition.js'
import { GuideBody, type GuideInjected } from './tabs/guide/GuideBody.js'
import { GuideTitle } from './tabs/guide/GuideTitle.js'
import { zh, en } from './locales.js'
import dockCss from './dockkit/components/dockkit.module.css?inline'
import guideCss from './tabs/guide/GuideBody.module.css?inline'
import type { Resources } from '../resources/contract.js'

declare module '@deepseek-ai/cordis' {
  interface Context { sidebarRight: import('./service.js').SidebarRightController }
}

/** Attach an optional native panel while retaining framework store and child-slot ownership. */
export function registerSidebarRight(ctx: ClientContext, tabs: SidebarRightTabRegistry, resources: Resources): () => void {
  const { controller, adopt } = createSidebarRightController(tabs, (address, signal) => resources.pin(address, signal))
  const disposeService = ctx.reflect.provide('sidebarRight', controller)
  const disposeLocale = ctx.locale.register('sidebarRight', { zh, en })
  const owner = createSidebarRightSessionStore(() => defaultSeed(tabs), adopt)
  const disposeGuideType = tabs.register(guideDefinition(ctx.locale.bind('sidebarRight')))
  const style = document.createElement('style')
  style.dataset.pluginCss = '@amiba/dsh-plugin-ui-shell/sidebar-right'
  style.textContent = dockCss + '\n' + guideCss
  document.head.append(style)
  const disposeSeat = ctx.slots.inject('amiba.workbench.panel', () => ctx.slots.register({
    name: 'amiba.workbench.panel', id: 'dsh-sidebar-right', store: owner.store, locale: 'sidebarRight',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
      'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
      'sidebar.right.tab.menu.item': { kind: 'list', scope: 'session' },
    },
    inject: (sessionId: SessionId): SidebarRightInjected => {
      let room: ReadonlyMap<PaneId, HalvesFit> = new Map()
      const dockHost = document.createElement('div')
      dockHost.style.display = 'contents'
      return {
      dockHost,
      reportRoom: fits => { room = fits },
      bindService: binding => controller.bind({ ...binding, canSplitPane: paneId => room.get(paneId)?.row !== false }),
      openTab: (kind, options) => controller.openTab(kind, options),
      hooks: { tabTypes: { subscribe: listener => tabs.subscribe(listener), getSnapshot: () => tabs.entries() } },
      keyedHooks: { tabNavigation: key => controller.tabDomain.occurrence(sessionId, { id: key as TabId }).navigation },
      occurrence: tab => controller.tabDomain.occurrence(sessionId, tab),
    }
    },
  }, NativeSidebarSeat))
  const disposeGuide = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: GUIDE_ID,
    children: { 'sidebar.right.tab.guide': { kind: 'chain', scope: 'session', inject: { hooks: { tabInfo: guideTabInfoFactory } } } },
    inject: (): GuideInjected => ({ hooks: { guideEntries: { subscribe: listener => tabs.subscribe(listener), getSnapshot: () => tabs.guide() } } }),
  }, GuideBody))
  const disposeTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: GUIDE_ID }, GuideTitle))
  return () => {
    disposeTitle()
    disposeGuide()
    disposeSeat()
    owner.dispose()
    disposeGuideType()
    controller.tabDomain.dispose()
    void disposeService()
    disposeLocale()
    style.remove()
  }
}
