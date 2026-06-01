/**
 * VSCode-style vertical resizable section list.
 *
 * Each section is a flex item with an adjustable ``flex-grow`` weight;
 * a 4px drag handle sits between every pair of adjacent expanded
 * sections and rebalances the two adjacent weights on mousemove. Other
 * sections are untouched — VSCode's "only the boundary I'm grabbing
 * moves" behaviour, not a cascading redistribution.
 *
 * Why weights and not absolute pixels:
 *   - Weights are layout-agnostic; the flex container handles
 *     window-resize, sibling collapse/expand, and font-size scaling
 *     without us having to re-derive pixel targets.
 *   - We translate the drag's pixel delta into weight units locally
 *     for the pair being dragged, using their current pixel heights —
 *     so 1px of drag visually moves the boundary 1px regardless of
 *     other panes' state.
 *
 * Collapsed sections are laid out at their natural header height
 * (``shrink-0``); they don't participate in the weight pool and never
 * get a handle adjacent to them.
 *
 * State is in-memory only — heights reset on view re-mount. Persistence
 * (per-user, per-window) can be added by lifting ``growMap`` into the
 * caller and wiring storage.
 */

import {
  Fragment,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { cn } from "@hermes-x/utils";

export interface ResizableItem {
  /** Stable id — used as a React key and as the weight map key. */
  id: string;
  /** Collapsed sections are out of the resize pool. */
  collapsed: boolean;
  /**
   * Minimum height in pixels when expanded. Drag clamps stop at this
   * value; defaults to 80 (room for the section header + a couple of
   * rows of content).
   */
  minPx?: number;
  /** Section body. The wrapper supplies the flex sizing — the body
   *  should expand to fill it (e.g. a TopSection in ``flex`` mode). */
  render: () => ReactNode;
}

interface Props {
  items: ResizableItem[];
  /** Forwarded to the outer flex column. */
  className?: string;
}

const HANDLE_PX = 4;
const DEFAULT_MIN_PX = 80;

export function ResizableSectionList({ items, className }: Props) {
  // Per-id flex-grow weight. ``undefined`` (missing key) means "use 1"
  // — the default share. After a drag, only the two touched ids are
  // populated; others keep using the default until they're dragged.
  const [growMap, setGrowMap] = useState<Map<string, number>>(new Map());
  const panelRefs = useRef(new Map<string, HTMLDivElement>());

  const getGrow = (id: string) => growMap.get(id) ?? 1;

  // Ids of currently expanded sections, in render order. Drives where
  // we place handles and which pair a handle rebalances.
  const expandedIds = items.filter((i) => !i.collapsed).map((i) => i.id);

  function beginDrag(
    aboveId: string,
    belowId: string,
    e: ReactMouseEvent<HTMLDivElement>,
  ): void {
    e.preventDefault();
    const aboveEl = panelRefs.current.get(aboveId);
    const belowEl = panelRefs.current.get(belowId);
    if (!aboveEl || !belowEl) return;

    const startY = e.clientY;
    const startHA = aboveEl.clientHeight;
    const startHB = belowEl.clientHeight;
    const startGA = getGrow(aboveId);
    const startGB = getGrow(belowId);
    const minA = items.find((i) => i.id === aboveId)?.minPx ?? DEFAULT_MIN_PX;
    const minB = items.find((i) => i.id === belowId)?.minPx ?? DEFAULT_MIN_PX;

    // 1 weight unit ↔ (hA + hB) / (gA + gB) pixels — for THIS pair, at
    // THIS moment. Other items' weights don't enter the equation
    // because flex distributes the pool proportionally and the pair's
    // share is (gA + gB) / Σg of (hA + hB).
    const denom = startGA + startGB;
    const pxPerWeight = denom > 0 ? (startHA + startHB) / denom : 1;

    function onMove(ev: MouseEvent): void {
      const dy = ev.clientY - startY;
      let newHA = startHA + dy;
      let newHB = startHB - dy;
      const sumH = startHA + startHB;
      if (newHA < minA) {
        newHA = minA;
        newHB = sumH - minA;
      }
      if (newHB < minB) {
        newHB = minB;
        newHA = sumH - minB;
      }
      const newGA = newHA / pxPerWeight;
      const newGB = newHB / pxPerWeight;
      setGrowMap((prev) => {
        const next = new Map(prev);
        next.set(aboveId, newGA);
        next.set(belowId, newGB);
        return next;
      });
    }

    function onUp(): void {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "ns-resize";
    // Suppress text selection that the drag would otherwise paint
    // across the sidebar — selection state survives mouseup and looks
    // like a UI glitch.
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {items.map((it) => {
        const expandedIdx = expandedIds.indexOf(it.id);
        const isLastExpanded =
          expandedIdx >= 0 && expandedIdx === expandedIds.length - 1;
        const belowId =
          expandedIdx >= 0 && !isLastExpanded
            ? expandedIds[expandedIdx + 1]
            : null;

        const refCallback = (el: HTMLDivElement | null): void => {
          if (el) panelRefs.current.set(it.id, el);
          else panelRefs.current.delete(it.id);
        };

        const style: CSSProperties | undefined = it.collapsed
          ? undefined
          : {
              flex: `${getGrow(it.id)} 1 0`,
              minHeight: it.minPx ?? DEFAULT_MIN_PX,
            };

        return (
          <Fragment key={it.id}>
            <div
              ref={refCallback}
              className={cn(
                "flex min-h-0 flex-col",
                it.collapsed && "shrink-0",
              )}
              style={style}
            >
              {it.render()}
            </div>
            {belowId && (
              <div
                role="separator"
                aria-orientation="horizontal"
                onMouseDown={(e) => beginDrag(it.id, belowId, e)}
                className="shrink-0 cursor-ns-resize bg-transparent transition-colors hover:bg-foreground/15 active:bg-foreground/25"
                style={{ height: HANDLE_PX }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
