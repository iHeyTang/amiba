// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
import type { PaneId, TabId } from '../dockkit/index.js'
import type { SidebarRightNavigationParams, SidebarRightResourceParams, SidebarRightTabParamsFor } from './params.js'

/** Where a tab was last navigated to: what the `open` that created or revealed it carried. */
export interface SidebarRightTabNavigation {
  /** The address opened; for a tab record this is its `contentId`. */
  readonly address: string
  /** The opener's `params` (see `contract/params.ts`); `undefined` when it gave none. */
  readonly params: SidebarRightNavigationParams
  /**
   * Incremented on every navigation to this tab, whether or not `params`
   * changed, so a body can act on "navigated again" alone. `0` for a record
   * nobody opened by address: a seeded guide, or a tab restored by undo.
   */
  readonly revision: number
}

/** Where an open from a tab lands. Without any of these it lands in the pane holding the tab at call time. */
export interface SidebarRightTabPlacement {
  /** Land a new tab in this pane instead. */
  readonly paneId?: PaneId
  /** Resource tabs reveal existing content by default; `false` permits duplicates. Pages always deduplicate within the target pane. */
  readonly revealIfOpened?: boolean
  /** `true` opens in this tab's place — its pane and strip slot — and closes this tab in the same step. */
  readonly replaceTab?: boolean
}

/** The actions one tab may take on itself; each acts on the session the tab is in. */
export interface SidebarRightTabActions {
  /**
   * Open a resource from this tab; see `ISidebarRight.openResource`.
   * @param address - a `dsh-resource://` address.
   * @param options - placement and the resource's navigation parameters.
   */
  openResource(address: string, options?: SidebarRightTabPlacement & { readonly params?: SidebarRightResourceParams }): void
  /**
   * Open a page type from this tab; see `ISidebarRight.openTab`.
   * @param kind - the page type's kind.
   * @param options - placement and that kind's navigation parameters.
   */
  openTab<K extends string>(kind: K, options?: SidebarRightTabPlacement & { readonly params?: SidebarRightTabParamsFor<K> }): void
  /** Close this tab. */
  close(): void
}

/** Where an open lands; every field is optional and the defaults are the common case. */
export interface SidebarRightPlacement {
  /** Land a new tab in this pane instead of the active docked one. */
  readonly paneId?: PaneId
  /** Take this tab's place — its pane and its strip slot — and close it in the same step. */
  readonly replaceTab?: TabId
  /**
   * Resource tabs reveal an existing (kind, contentId) by default; `false`
   * permits duplicates. Pages always deduplicate within the target pane.
   */
  readonly revealIfOpened?: boolean
}

/** How a caller wants a resource opened. */
export interface SidebarRightOpenResourceOptions extends SidebarRightPlacement {
  /** Name the opening type instead of letting the registry rank claims; its `canOpen` still applies. */
  readonly kind?: string
  /** The resource's navigation parameters, typed by resource type; delivered as `navigation.params`. */
  readonly params?: SidebarRightResourceParams
}

/** How a caller wants a page type opened. */
export interface SidebarRightOpenTabOptions<K extends string = string> extends SidebarRightPlacement {
  /** That kind's navigation parameters, typed by kind; delivered as `navigation.params`. */
  readonly params?: SidebarRightTabParamsFor<K>
}
