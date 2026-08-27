import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useHorizontalWheelScroll } from "../useHorizontalWheelScroll";

function Rail({ overflowing }: { overflowing: boolean }) {
  const ref = useHorizontalWheelScroll<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="rail">
      {overflowing ? "wide" : "narrow"}
    </div>
  );
}

/**
 * The real rail is conditionally rendered: the workbench tab strip only exists
 * once a session or a tab does, which is long after the pane first mounts.
 */
function LateRail({ present }: { present: boolean }) {
  const ref = useHorizontalWheelScroll<HTMLDivElement>();
  return present ? <div ref={ref} data-testid="rail" /> : <span />;
}

/** jsdom reports every box as 0x0, so the overflow state has to be staged. */
function stage(node: HTMLElement, overflowing: boolean) {
  Object.defineProperty(node, "scrollWidth", {
    configurable: true,
    value: overflowing ? 500 : 100,
  });
  Object.defineProperty(node, "clientWidth", {
    configurable: true,
    value: 100,
  });
  let scrollLeft = 0;
  Object.defineProperty(node, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    // Clamp like a real scroll container, so the end-of-rail case is real.
    set: (next: number) =>
      (scrollLeft = Math.max(
        0,
        Math.min(next, node.scrollWidth - node.clientWidth),
      )),
  });
}

function wheel(node: HTMLElement, deltaX: number, deltaY: number) {
  const event = new WheelEvent("wheel", {
    deltaX,
    deltaY,
    bubbles: true,
    cancelable: true,
  });
  node.dispatchEvent(event);
  return event;
}

describe("useHorizontalWheelScroll", () => {
  it("turns a vertical wheel into horizontal scrolling", () => {
    const { getByTestId } = render(<Rail overflowing />);
    const rail = getByTestId("rail");
    stage(rail, true);

    const event = wheel(rail, 0, 120);

    expect(rail.scrollLeft).toBe(120);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a horizontal wheel to the browser", () => {
    const { getByTestId } = render(<Rail overflowing />);
    const rail = getByTestId("rail");
    stage(rail, true);

    // Trackpad horizontal intent: deltaX dominates and is handled natively.
    const event = wheel(rail, 90, 10);

    expect(rail.scrollLeft).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it("lets the gesture chain when the rail does not overflow", () => {
    const { getByTestId } = render(<Rail overflowing={false} />);
    const rail = getByTestId("rail");
    stage(rail, false);

    const event = wheel(rail, 0, 120);

    expect(rail.scrollLeft).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it("binds a rail that appears after the hook's first render", () => {
    const { getByTestId, rerender } = render(<LateRail present={false} />);
    rerender(<LateRail present />);
    const rail = getByTestId("rail");
    stage(rail, true);

    const event = wheel(rail, 0, 120);

    expect(rail.scrollLeft).toBe(120);
    expect(event.defaultPrevented).toBe(true);
  });

  it("releases the rail when it unmounts", () => {
    const { getByTestId, rerender } = render(<LateRail present />);
    const rail = getByTestId("rail");
    stage(rail, true);
    rerender(<LateRail present={false} />);

    // Detached node: the listener must be gone, not merely inert.
    expect(wheel(rail, 0, 120).defaultPrevented).toBe(false);
    expect(rail.scrollLeft).toBe(0);
  });

  it("lets the gesture chain once the rail is scrolled to its end", () => {
    const { getByTestId } = render(<Rail overflowing />);
    const rail = getByTestId("rail");
    stage(rail, true);
    rail.scrollLeft = 400; // scrollWidth - clientWidth

    const event = wheel(rail, 0, 120);

    expect(rail.scrollLeft).toBe(400);
    expect(event.defaultPrevented).toBe(false);
  });
});
