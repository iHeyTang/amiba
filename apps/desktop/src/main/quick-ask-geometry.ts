export type QuickAskResizeAnchor = "top" | "center" | "bottom"

export interface QuickAskBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Resolve the next window bounds without losing the chosen screen anchor.
 * The empty Quick Ask stage uses the center so the compact composer and its
 * modal dialogs share one screen coordinate.
 */
export function resolveQuickAskResizeBounds(
  bounds: QuickAskBounds,
  height: number,
  anchor: QuickAskResizeAnchor,
): QuickAskBounds {
  const y =
    anchor === "bottom"
      ? bounds.y + bounds.height - height
      : anchor === "center"
        ? bounds.y + Math.round((bounds.height - height) / 2)
        : bounds.y
  return {
    ...bounds,
    y,
    height,
  }
}

/**
 * Reposition an already-sized Quick Ask window on summon without changing
 * the screen coordinate represented by its last resize anchor.
 */
export function resolveQuickAskSummonBounds(
  compactTarget: QuickAskBounds,
  currentHeight: number,
  anchor: QuickAskResizeAnchor,
): QuickAskBounds {
  const y =
    anchor === "bottom"
      ? compactTarget.y + compactTarget.height - currentHeight
      : anchor === "center"
        ? compactTarget.y +
          Math.round((compactTarget.height - currentHeight) / 2)
        : compactTarget.y
  return {
    ...compactTarget,
    y,
    height: currentHeight,
  }
}
