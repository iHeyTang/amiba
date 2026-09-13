// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
/**
 * The right Sidebar's extension seats; locale and root ownership are wired separately.
 *
 * Four seats, each with a different reason to exist:
 * - `sidebar.right.pane.tab` is how a tab type contributes a body. It is keyed by
 *   the type definition's `id`, so adding a type is a registration, never an
 *   edit here. The key domain stays the open string space because a tab type may
 *   ship from outside this repository.
 * - `sidebar.right.pane.tab.title` is the same dispatch for what the chip shows
 *   as the tab's title. Registering is optional: without an entry the chip shows
 *   the title the registry captured when the tab opened.
 * - `sidebar.right.tab.guide` lets a product replace the guide tab's contents
 *   without replacing the tab. It is a chain because the replacement decides for
 *   itself whether it applies, and the shipped guide is the owner's fallback.
 * - `sidebar.right.tab.menu.item` extends a tab's actions menu. The kit owns the
 *   actions that are gestures on the layout itself; this seat is for actions that
 *   mean something about the tab's content.
 *
 * TYPE HOME RATIONALE: this package declares all four at runtime, and anything
 * registering into one already depends on it for the declaration. The types
 * therefore live with their declarer.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { PaneId, TabRecord } from '../dockkit/index.js'
import type { SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type { TabHookContext } from '../tab-info.js'
import type { SidebarRightTabActions, SidebarRightTabNavigation } from './navigation.js'
export type { SidebarRightTabActions, SidebarRightTabNavigation, SidebarRightTabPlacement } from './navigation.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One tab's body, dispatched with the `id` of the type in force for
     * `tab.kind`. A tab type registers here under its definition's `id` and
     * receives every tab of that kind, in every pane, docked or floating. A kind
     * with no type in force renders the owner's "nothing can view this" notice
     * rather than an empty pane.
     */
    'sidebar.right.pane.tab': {
      kind: 'keyed'
      scope: 'session'
      hookContext: TabHookContext
      inject: SidebarRightTabInjected
    }
    /**
     * A tab's title as its chip (and a floating panel's header) shows it,
     * dispatched with the same key and information hook as the body. A type with a
     * live title — a terminal named after its shell, a chat after its first
     * line — registers here and reads its own store; one without registers
     * nothing and the chip shows the registry's `title(address)` text captured
     * at open time.
     */
    'sidebar.right.pane.tab.title': {
      kind: 'keyed'
      scope: 'session'
      hookContext: TabHookContext
      inject: SidebarRightTabInjected
    }
    /**
     * The guide tab's body. Selectors run in chain order and the first
     * non-declining entry replaces the shipped guide entirely; with no entry, or
     * with every entry declining, the shipped guide renders.
     */
    'sidebar.right.tab.guide': {
      kind: 'chain'
      scope: 'session'
      hookContext: UseSidebarRightTabInfo
      inject: { hooks: { tabInfo: SlotHookFactory<'sidebar.right.tab.guide', UseSidebarRightTabInfo> } }
    }
    /**
     * Extra items at the end of one tab's actions menu, in registration order.
     * Entries decide their own visibility from the tab they are given. Without a
     * registrant the menu shows only the kit's own layout actions.
     */
    'sidebar.right.tab.menu.item': { kind: 'list'; scope: 'session'; owner: SidebarRightTabMenuOwnerProps }
  }
}

/** Live information shared by a tab's body, title, and guide replacement. */
export interface SidebarRightTabInfo {
  readonly sidebar: {
    readonly expanded: boolean
    /** Presentation selected by manual mode or viewport width; preserved while collapsed. */
    readonly fullscreen: boolean
  }
  readonly panel: { readonly id: PaneId }
  readonly tab: TabRecord & {
    /** Docked bodies need an expanded sidebar and an active tab; expanded titles include inactive tabs. Floats stay visible. */
    readonly visible: boolean
    readonly navigation: SidebarRightTabNavigation
    /** Aborted only when the record disappears or this plugin unloads, not on hide or session switch. */
    readonly signal: AbortSignal
    readonly actions: SidebarRightTabActions
  }
}

/**
 * Read current tab information through the slot framework's subscriptions.
 * @returns the sidebar presentation, containing pane, and live tab record.
 */
export type UseSidebarRightTabInfo = () => SidebarRightTabInfo

/** The slot-owned hook shared by every tab body and title registration. */
export interface SidebarRightTabInjected {
  hooks: { tabInfo: SlotHookFactory<'sidebar.right.pane.tab', UseSidebarRightTabInfo> }
}

/** Owner share of one tab-menu item occurrence. */
export interface SidebarRightTabMenuOwnerProps {
  /** The tab whose menu is open. */
  tab: TabRecord
  /**
   * Dismiss the menu.
   *
   * An item that acts MUST call this: the menu is the kit's, and it closes on
   * its own actions only. An item that leaves it open leaves a menu floating
   * over content the action may have just replaced.
   */
  dismiss: () => void
}
