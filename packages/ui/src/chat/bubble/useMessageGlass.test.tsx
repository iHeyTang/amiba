import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageGlass } from "./useMessageGlass";

let pending: { resolve: () => void; reject: () => void }[];
let resize: () => void;
let width: number;
function Fixture({ complete = true }: { complete?: boolean }) {
  const ref = useMessageGlass(complete, "left");
  return <div ref={ref} data-testid="chrome"><div data-message-glass-body /><div data-background-surface="message-actions" /></div>;
}
beforeEach(() => {
  pending = [];
  width = 400;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(120);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("Image", class {
    src = "";
    decode() { return new Promise<void>((resolve, reject) => pending.push({ resolve, reject: () => reject(new Error("decode failed")) })); }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settle = async (...indices: number[]) => act(async () => { indices.forEach(i => pending[i].resolve()); });
describe("message glass readiness", () => {
  it("keeps the body background until both mask states decode", async () => {
    const { getByTestId } = render(<Fixture />);
    const chrome = getByTestId("chrome");
    expect(chrome).not.toHaveAttribute("data-unified-glass");
    await settle(0);
    expect(chrome).not.toHaveAttribute("data-unified-glass");
    await settle(1);
    expect(chrome).toHaveAttribute("data-unified-glass");
    expect(chrome.style.getPropertyValue("--assistant-glass-mask")).toContain("svg+xml");
  });
  it("retains the previous mask while resizing and ignores stale results", async () => {
    const { getByTestId } = render(<Fixture />);
    const chrome = getByTestId("chrome");
    await settle(0, 1);
    const original = chrome.style.getPropertyValue("--assistant-glass-mask");
    act(() => { width = 500; resize(); width = 600; resize(); });
    expect(chrome).toHaveAttribute("data-unified-glass");
    await settle(2, 3);
    expect(chrome.style.getPropertyValue("--assistant-glass-mask")).toBe(original);
    await settle(4, 5);
    expect(chrome.style.getPropertyValue("--assistant-glass-mask")).toContain("600");
  });
  it("defers all measurement while the group is streaming", () => {
    const { getByTestId } = render(<Fixture complete={false} />);
    const chrome = getByTestId("chrome");
    // No ResizeObserver wiring and no Image.decode() work while streaming:
    expect(chrome).not.toHaveAttribute("data-unified-glass");
    expect(pending).toHaveLength(0);
  });

  it("applies glass once the group settles (complete flips)", async () => {
    const { getByTestId, rerender } = render(<Fixture complete={false} />);
    const chrome = getByTestId("chrome");
    expect(chrome).not.toHaveAttribute("data-unified-glass");
    rerender(<Fixture complete={true} />);
    expect(pending).toHaveLength(2);
    await settle(0, 1);
    expect(chrome).toHaveAttribute("data-unified-glass");
  });

  it("falls back to the body on decode failure and ignores unmounted work", async () => {
    const { getByTestId, unmount } = render(<Fixture />);
    const chrome = getByTestId("chrome");
    await act(async () => pending[0].reject());
    expect(chrome).not.toHaveAttribute("data-unified-glass");
    act(() => resize());
    unmount();
    await settle(2, 3);
    expect(chrome).not.toHaveAttribute("data-unified-glass");
  });
});
