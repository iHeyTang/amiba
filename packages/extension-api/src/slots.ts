import type { ComponentType, ReactNode } from "react"

export type SlotName =
  | "activityBar.item"
  | "sidebar.view"
  | "settings.tab"
  | "composer.hint"

export interface SlotEntry<P = unknown> {
  /** Owning extension id. */
  extensionId: string
  /** Unique within (extensionId, slot). Matches manifest contribute id when available. */
  entryId: string
  /** Render order (lower first). Falls back to manifest order. */
  order: number
  /** React component to render. Receives `slotProps` merged with the outlet's runtime props. */
  component: ComponentType<P>
  /** Optional static props bound at register time. */
  props?: Partial<P>
}

export interface SlotContext {
  extensionId: string
  slot: SlotName
}

/** Props an outlet may pass to all entries in a multi-instance slot. */
export type MultiSlotChildren = ReactNode
