/**
 * GitHub-style activity heatmap — generic over the cell payload so
 * different extensions can plug in their own value / popover detail.
 *
 * Layout:
 *   • Month axis above the grid
 *   • Day-of-week labels (Mon/Wed/Fri) to the left of the grid
 *   • Columns = weeks, oldest left → newest right
 *   • Latest day anchored to its real day-of-week slot in the right-
 *     most column; future-of-current-week cells render blank
 *
 * Cell size is fixed (HEATMAP_CELL_PX). When the container is too
 * narrow to fit every week column the grid overflows horizontally
 * and the wrapper scrolls; a non-passive wheel listener translates
 * mouse-wheel deltaY into horizontal scroll so users without
 * trackpad horizontal gestures can still navigate.
 *
 * Lifted from extensions/token-meter so other telemetry surfaces
 * (plugin usage views, future agent-self-introspection panels) can
 * reuse the same visual language without duplication.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "../primitives"

const HEATMAP_CELL_PX = 10
const HEATMAP_CELL_GAP_PX = 2

const DEFAULT_MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

export interface HeatmapCellBase {
  /** YYYY-MM-DD in the user's local calendar. */
  day: string
  /** Raw value the day's bucket aggregated to — used only for the
   *  caller's `formatValue`. Heatmap itself doesn't interpret it. */
  value: number
  /** Intensity bucket 0-4. 0 = no activity; 1-4 = quartiles among
   *  non-zero days in the window. Computed by the caller. */
  level: 0 | 1 | 2 | 3 | 4
}

export interface HeatmapProps<T extends HeatmapCellBase> {
  cells: T[]
  /** Format the tooltip's value line, e.g. "1.2M tokens" / "47 calls". */
  formatValue: (cell: T) => string
  /** Optional rows rendered below the value line in the tooltip —
   *  per-model breakdown, per-tool breakdown, etc. */
  renderDetail?: (cell: T) => ReactNode
  /** Single-letter day-of-week labels; rendered on rows 1/3/5 of the
   *  Sunday-indexed grid. */
  dowLabels: { mon: string; wed: string; fri: string }
  /** Tooltip line shown when value === 0. */
  emptyLabel: string
  legend: { less: string; more: string }
  /** Localised month axis labels; defaults to English short names. */
  monthNames?: string[]
  /** Width reserved for the dow-label column — bigger for wider
   *  glyphs (zh: 18, en: 16). */
  dowLabelWidth?: number
  /** Empty-state message shown when `cells` is empty. */
  emptyStateLabel?: string
}

type CellSlot<T extends HeatmapCellBase> = T | null

interface HeatmapLayout<T extends HeatmapCellBase> {
  cols: CellSlot<T>[][]
  colMonths: Array<number | null>
}

function buildLayout<T extends HeatmapCellBase>(
  cells: T[],
): HeatmapLayout<T> | null {
  const total = cells.length
  if (total === 0) return null
  const latestDay = new Date(cells[total - 1]!.day).getDay()
  const trailingPad = 6 - latestDay
  const slots: CellSlot<T>[] = []
  for (let i = 0; i < trailingPad; i++) slots.push(null)
  for (let i = total - 1; i >= 0; i--) slots.push(cells[i]!)
  while (slots.length % 7 !== 0) slots.push(null)
  const cols: CellSlot<T>[][] = []
  for (let i = 0; i < slots.length; i += 7) {
    cols.push(slots.slice(i, i + 7).reverse())
  }
  cols.reverse()
  const colMonths = cols.map((col) => {
    for (const c of col) {
      if (c) return new Date(c.day).getMonth()
    }
    return null
  })
  return { cols, colMonths }
}

function levelClass(level: HeatmapCellBase["level"]): string {
  switch (level) {
    case 0:
      return "bg-muted/50"
    case 1:
      return "bg-primary/20"
    case 2:
      return "bg-primary/40"
    case 3:
      return "bg-primary/65"
    case 4:
      return "bg-primary"
  }
}

export function Heatmap<T extends HeatmapCellBase>({
  cells,
  formatValue,
  renderDetail,
  dowLabels,
  emptyLabel,
  legend,
  monthNames = DEFAULT_MONTH_NAMES,
  dowLabelWidth = 16,
  emptyStateLabel,
}: HeatmapProps<T>) {
  const layout = useMemo(() => buildLayout<T>(cells), [cells])

  // Absorb every wheel event inside the heatmap track and apply the
  // dominant delta as horizontal scroll. Why unconditionally absorb:
  // when a user wheels over the heatmap they almost never mean "scroll
  // the outer panel" — they're trying to navigate weeks. Letting the
  // event bubble feels glitchy (you start panning weeks, then suddenly
  // the whole panel jumps). passive: false is required so
  // preventDefault is honoured; React's onWheel prop is passive in
  // modern versions, hence the manual addEventListener.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      if (el.scrollWidth <= el.clientWidth) return
      // Trackpads emit deltaX for native horizontal pans; plain mouse
      // wheels only emit deltaY. Pick whichever is larger so both
      // gestures translate to horizontal scroll.
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      el.scrollLeft += delta
    }
    el.addEventListener("wheel", handler, { passive: false })
    return () => el.removeEventListener("wheel", handler)
  }, [])

  // Anchor the initial view to the rightmost column — today's cell —
  // so the first thing the user sees is the most-recent activity.
  // Re-run whenever the cell set changes (new data, range switch); a
  // mid-scroll re-render of the SAME cells won't trigger this so user
  // scroll position is preserved.
  //
  // Two details that matter for the "scrollbar flashes on load" bug:
  //   • Guard on actual overflow — assigning scrollLeft when content
  //     already fits triggers macOS overlay scrollbars to briefly
  //     fade in even though the value doesn't change.
  //   • useLayoutEffect (not useEffect) so the scroll lands before
  //     paint; otherwise the user sees the leftmost frame first and
  //     the jump-to-right registers as a scroll event.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollWidth <= el.clientWidth) return
    el.scrollLeft = el.scrollWidth
  }, [cells])

  if (!layout) {
    return (
      <p className="text-xs text-muted-foreground/70">
        {emptyStateLabel ?? emptyLabel}
      </p>
    )
  }

  const gap = HEATMAP_CELL_GAP_PX
  const cellSize = HEATMAP_CELL_PX

  const monthLabels = layout.colMonths.map((m, ci) => {
    if (m === null) return null
    if (ci > 0 && layout.colMonths[ci - 1] === m) return null
    return m
  })

  return (
    <TooltipProvider delayDuration={80} skipDelayDuration={50}>
      <div>
        {/* Scroll track. dow labels stay sticky on the left so they're
            always readable; month axis and grid scroll together. */}
        <div
          ref={scrollRef}
          className="relative overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex w-fit items-start">
            {/* Sticky day-of-week labels (placeholder row for the month
                axis at top, then 7 dow rows). */}
            <div
              className="sticky left-0 z-[1] flex flex-col bg-background pr-1 text-xs uppercase tracking-wide text-muted-foreground/60"
              style={{ width: dowLabelWidth }}
            >
              <div style={{ height: cellSize + 4 }} />
              <div className="flex flex-col" style={{ gap }}>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="flex items-center leading-none"
                    style={{ height: cellSize }}
                  >
                    {i === 1
                      ? dowLabels.mon
                      : i === 3
                        ? dowLabels.wed
                        : i === 5
                          ? dowLabels.fri
                          : ""}
                  </div>
                ))}
              </div>
            </div>

            {/* Scrolling column: month axis + grid stacked. */}
            <div>
              {/* Month axis */}
              <div
                className="flex select-none pb-1 text-xs uppercase tracking-wide text-muted-foreground/70"
                style={{ height: cellSize + 4, gap }}
              >
                {monthLabels.map((m, ci) => (
                  <div
                    key={ci}
                    style={{ width: cellSize }}
                    className="flex justify-start whitespace-nowrap"
                  >
                    {m !== null ? monthNames[m] : ""}
                  </div>
                ))}
              </div>

              {/* Weeks columns */}
              <div className="flex" style={{ gap }}>
                {layout.cols.map((col, ci) => (
                  <div key={ci} className="flex flex-col" style={{ gap }}>
                    {col.map((cell, ri) =>
                      cell ? (
                        <Tooltip key={ri}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "block rounded-[3px] outline-none ring-foreground/40 transition-colors focus-visible:ring-2",
                                levelClass(cell.level),
                              )}
                              style={{ width: cellSize, height: cellSize }}
                              aria-label={`${cell.day} ${formatValue(cell)}`}
                            />
                          </TooltipTrigger>
                          <HeatmapTooltipContent
                            cell={cell}
                            emptyLabel={emptyLabel}
                            formatValue={formatValue}
                            renderDetail={renderDetail}
                          />
                        </Tooltip>
                      ) : (
                        <div
                          key={ri}
                          style={{ width: cellSize, height: cellSize }}
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-muted-foreground/70">
          <span>{legend.less}</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <div
              key={lvl}
              className={cn(
                "rounded-[3px]",
                levelClass(lvl as HeatmapCellBase["level"]),
              )}
              style={{ width: cellSize, height: cellSize }}
            />
          ))}
          <span>{legend.more}</span>
        </div>
      </div>
    </TooltipProvider>
  )
}

/**
 * Non-interactive cell detail belongs to Tooltip, not Popover. The shared
 * primitive owns its Portal and collision-aware positioning, so this content
 * cannot be clipped by the heatmap's horizontal overflow track.
 */
function HeatmapTooltipContent<T extends HeatmapCellBase>({
  cell,
  formatValue,
  renderDetail,
  emptyLabel,
}: {
  cell: T
  formatValue: (cell: T) => string
  renderDetail?: (cell: T) => ReactNode
  emptyLabel: string
}) {
  const hasActivity = cell.value > 0

  return (
    <TooltipContent className="whitespace-nowrap" side="top" sideOffset={4}>
      <div className="font-mono text-muted-foreground">{cell.day}</div>
      {hasActivity ? (
        <>
          <div className="tabular-nums">{formatValue(cell)}</div>
          {renderDetail ? (
            <div className="mt-1 border-t border-border/40 pt-1">
              {renderDetail(cell)}
            </div>
          ) : null}
        </>
      ) : (
        <div className="italic text-muted-foreground/70">{emptyLabel}</div>
      )}
    </TooltipContent>
  )
}
