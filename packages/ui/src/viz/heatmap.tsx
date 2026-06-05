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
 * Cell size is computed from the container width so the grid never
 * overflows its parent; floors at HEATMAP_CELL_MIN_PX before allowing
 * overflow. Hover (or focus) opens a popover anchored above the cell
 * showing the day + the caller-formatted value + an optional detail
 * list.
 *
 * Lifted from extensions/token-meter so other telemetry extensions
 * (tool-meter, future agent-self-introspection panels) can reuse the
 * same visual language without duplication.
 */

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { cn } from "../primitives"

const HEATMAP_CELL_PX = 14
const HEATMAP_CELL_GAP_PX = 3
const HEATMAP_CELL_MIN_PX = 8

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
  /** Format the popover's value line, e.g. "1.2M tokens" / "47 calls". */
  formatValue: (cell: T) => string
  /** Optional rows rendered below the value line in the popover —
   *  per-model breakdown, per-tool breakdown, etc. */
  renderDetail?: (cell: T) => ReactNode
  /** Single-letter day-of-week labels; rendered on rows 1/3/5 of the
   *  Sunday-indexed grid. */
  dowLabels: { mon: string; wed: string; fri: string }
  /** Popover line shown when value === 0. */
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
  const [hovered, setHovered] = useState<{
    cell: T
    row: number
    col: number
  } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (typeof w === "number") setContainerWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!layout) {
    return (
      <p className="text-[11px] text-muted-foreground/70">
        {emptyStateLabel ?? emptyLabel}
      </p>
    )
  }

  const gap = HEATMAP_CELL_GAP_PX
  const colsCount = layout.cols.length
  const availableForCells = Math.max(0, containerWidth - dowLabelWidth - 4)
  const idealCell =
    colsCount > 0
      ? Math.floor((availableForCells - (colsCount - 1) * gap) / colsCount)
      : HEATMAP_CELL_PX
  const cellSize =
    containerWidth === 0
      ? HEATMAP_CELL_PX
      : Math.max(HEATMAP_CELL_MIN_PX, Math.min(HEATMAP_CELL_PX, idealCell))

  const monthLabels = layout.colMonths.map((m, ci) => {
    if (m === null) return null
    if (ci > 0 && layout.colMonths[ci - 1] === m) return null
    return m
  })

  return (
    <div className="relative" ref={containerRef}>
      {/* Month axis */}
      <div
        className="flex select-none gap-[3px] pb-1 text-[9px] uppercase tracking-wide text-muted-foreground/70"
        style={{ paddingLeft: dowLabelWidth + 4 }}
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

      <div className="flex items-start">
        {/* Day-of-week labels */}
        <div
          className="flex flex-col text-[9px] uppercase tracking-wide text-muted-foreground/60"
          style={{ width: dowLabelWidth, gap }}
        >
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

        {/* Weeks columns */}
        <div className="flex" style={{ gap }}>
          {layout.cols.map((col, ci) => (
            <div key={ci} className="flex flex-col" style={{ gap }}>
              {col.map((cell, ri) =>
                cell ? (
                  <button
                    key={ri}
                    type="button"
                    onMouseEnter={() => setHovered({ cell, row: ri, col: ci })}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered({ cell, row: ri, col: ci })}
                    onBlur={() => setHovered(null)}
                    className={cn(
                      "block rounded-[3px] outline-none ring-foreground/40 transition-colors focus-visible:ring-2",
                      levelClass(cell.level),
                    )}
                    style={{ width: cellSize, height: cellSize }}
                    aria-label={`${cell.day} ${formatValue(cell)}`}
                  />
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

      {hovered && (
        <Popover
          cell={hovered.cell}
          col={hovered.col}
          row={hovered.row}
          dowLabelWidth={dowLabelWidth}
          gap={gap}
          cellSize={cellSize}
          formatValue={formatValue}
          renderDetail={renderDetail}
          emptyLabel={emptyLabel}
        />
      )}

      {/* Legend */}
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground/70">
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
  )
}

function Popover<T extends HeatmapCellBase>({
  cell,
  col,
  row,
  dowLabelWidth,
  gap,
  cellSize,
  formatValue,
  renderDetail,
  emptyLabel,
}: {
  cell: T
  col: number
  row: number
  dowLabelWidth: number
  gap: number
  cellSize: number
  formatValue: (cell: T) => string
  renderDetail?: (cell: T) => ReactNode
  emptyLabel: string
}) {
  const monthAxisHeight = cellSize + 4
  const xCellCenter =
    dowLabelWidth + 4 + col * (cellSize + gap) + cellSize / 2
  const yCellTop = monthAxisHeight + row * (cellSize + gap)

  const hasActivity = cell.value > 0

  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border/80 bg-popover px-2.5 py-1.5 text-[10px] text-popover-foreground shadow-md"
      style={{ left: xCellCenter, top: yCellTop - 4 }}
    >
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
    </div>
  )
}
