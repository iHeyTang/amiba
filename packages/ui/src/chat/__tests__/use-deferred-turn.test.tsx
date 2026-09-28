import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { useDeferredTurn } from "../bubble/use-deferred-turn";

let intersections: IntersectionObserverCallback[];
let resizes: ResizeObserverCallback[];
beforeEach(() => {
  intersections = []; resizes = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersections.push(callback); }
    observe() {} disconnect() {}
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resizes.push(callback); }
    observe() {} disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Disclosure() {
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(!open)}>{open ? "Expanded tool result" : "Open tool result"}</button>;
}
function Turn({ scope, deferred = true }: {scope?: object; deferred?: boolean}) {
  const {ref, ready, height} = useDeferredTurn(scope, "first", deferred);
  return <div ref={ref} data-testid="turn" style={ready ? undefined : {height}}>{ready && <Disclosure />}</div>;
}
function intersect(index: number, visible: boolean) {
  act(() => intersections[index]!([{isIntersecting:visible} as IntersectionObserverEntry], {} as IntersectionObserver));
}

it("defers first creation, then retains expanded tool state after leaving the viewport", () => {
  render(<Turn scope={{}} />);
  expect(screen.queryByRole("button")).toBeNull();
  intersect(0, true);
  fireEvent.click(screen.getByRole("button"));
  intersect(0, false);
  expect(screen.getByRole("button").textContent).toBe("Expanded tool result");
});

it("restores measured history height on return without treating a hidden panel as zero height", () => {
  const scope = {};
  const view = render(<Turn scope={scope} />);
  intersect(0, true);
  act(() => resizes[0]!([{borderBoxSize:[{blockSize:742}]} as unknown as ResizeObserverEntry], {} as ResizeObserver));
  act(() => resizes[0]!([{borderBoxSize:[{blockSize:0}]} as unknown as ResizeObserverEntry], {} as ResizeObserver));
  view.unmount();
  render(<Turn scope={scope} />);
  expect(screen.getByTestId("turn").style.height).toBe("742px");
  expect(screen.queryByRole("button")).toBeNull();
});

it("renders an active turn immediately and isolates height caches between conversations", () => {
  const view = render(<Turn scope={{}} deferred={false} />);
  expect(screen.getByRole("button")).toBeTruthy();
  act(() => resizes[0]!([{borderBoxSize:[{blockSize:742}]} as unknown as ResizeObserverEntry], {} as ResizeObserver));
  view.unmount();
  render(<Turn scope={{}} />);
  expect(screen.getByTestId("turn").style.height).toBe("160px");
});

it("does not hide already rendered content when expansion makes a turn eligible for deferral", () => {
  const scope = {};
  const view = render(<Turn scope={scope} deferred={false} />);
  fireEvent.click(screen.getByRole("button"));
  view.rerender(<Turn scope={scope} deferred />);
  expect(screen.getByRole("button").textContent).toBe("Expanded tool result");
});

it("keeps unscoped and observer-free renderers usable", () => {
  const view = render(<Turn />);
  expect(screen.getByRole("button")).toBeTruthy();
  view.unmount();
  vi.stubGlobal("IntersectionObserver", undefined);
  render(<Turn scope={{}} />);
  expect(screen.getByRole("button")).toBeTruthy();
});
