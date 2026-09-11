import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useSurfaceInteraction,
  InteractionRegion,
  createSurfaceInteraction,
} from "../interaction-region";
import type { SurfaceInteraction } from "@amiba/extension-sdk";
import {
  ComposerAccessory,
  EmptyStateVisualProvider,
} from "../empty-state-visual";

afterEach(() => vi.useRealTimers());
describe("region interaction", () => {
  it("tracks input activity with a quiet timeout and clears it on blur", () => {
    vi.useFakeTimers();
    const store = createSurfaceInteraction();
    store.focus();
    store.activity();
    vi.advanceTimersByTime(500);
    store.activity();
    vi.advanceTimersByTime(500);
    expect(store.getSnapshot().input.active).toBe(true);
    vi.advanceTimersByTime(150);
    expect(store.getSnapshot().input.active).toBe(false);
    store.composition(true);
    vi.advanceTimersByTime(1000);
    expect(store.getSnapshot().input.composing).toBe(true);
    store.blur();
    expect(store.getSnapshot().input).toEqual({
      focused: false,
      active: false,
      composing: false,
    });
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("observes editor input without cancelling it and isolates sibling regions", () => {
    let first!: SurfaceInteraction, second!: SurfaceInteraction;
    function Probe({ index }: { index: number }) {
      const s = useSurfaceInteraction()!;
      if (index === 1) first = s;
      else second = s;
      return null;
    }
    render(
      <>
        <InteractionRegion>
          <Probe index={1} />
          <div data-composer-card>
            <input aria-label="Draft" />
          </div>
        </InteractionRegion>
        <InteractionRegion>
          <Probe index={2} />
        </InteractionRegion>
      </>,
    );
    const editor = screen.getByLabelText("Draft");
    fireEvent.focus(editor);
    expect(first.getSnapshot().input.focused).toBe(true);
    expect(fireEvent.input(editor, { target: { value: "private text" } })).toBe(
      true,
    );
    expect(first.getSnapshot().input.active).toBe(true);
    expect(JSON.stringify(first.getSnapshot())).not.toContain("private text");
    expect(second.getSnapshot().input.active).toBe(false);
    fireEvent.blur(editor);
    const before = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "private text",
      inputType: "insertText",
    });
    editor.addEventListener("beforeinput", (e) => e.preventDefault(), {
      once: true,
    });
    act(() => editor.dispatchEvent(before));
    expect(before.defaultPrevented).toBe(true);
    expect(first.getSnapshot().input.active).toBe(true);
    expect(JSON.stringify(first.getSnapshot())).not.toContain("private text");
    fireEvent.compositionStart(editor);
    expect(first.getSnapshot().input.composing).toBe(true);
    fireEvent.compositionEnd(editor);
    expect(first.getSnapshot().input.composing).toBe(false);
    fireEvent.blur(editor);
    expect(first.getSnapshot().input.focused).toBe(false);
  });
  it("normalizes pointer movement against the entire region and reports leaving", () => {
    let interaction!: SurfaceInteraction;
    function Probe() {
      interaction = useSurfaceInteraction()!;
      return null;
    }
    const { getByTestId } = render(
      <InteractionRegion data-testid="region">
        <Probe />
        <span>small visual</span>
      </InteractionRegion>,
    );
    const region = getByTestId("region");
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: 400,
      height: 200,
    } as DOMRect);
    act(() =>
      region.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 310,
          clientY: 70,
        }),
      ),
    );
    expect(interaction.getSnapshot().pointer).toEqual({ x: 0.5, y: -0.5 });
    fireEvent.pointerLeave(region);
    expect(interaction.getSnapshot().pointer).toBeNull();
  });
  it("supplies the same interaction subscription to the accessory", () => {
    let interaction: SurfaceInteraction | undefined;
    render(
      <EmptyStateVisualProvider
        render={({ defaultVisual }) => defaultVisual}
        accessory={(owner) => {
          interaction = owner.interaction;
          return <span>accessory</span>;
        }}
      >
        <InteractionRegion>
          <ComposerAccessory />
        </InteractionRegion>
      </EmptyStateVisualProvider>,
    );
    expect(
      screen.getByText("accessory").closest("[data-composer-accessory]"),
    ).not.toBeNull();
    expect(interaction?.getSnapshot().pointer).toBeNull();
  });
});

it("disables presentation leases on document hide and region unmount", () => {
  let coordinator:
    | import("@amiba/extension-sdk").PresentationCoordinator
    | undefined;
  const { unmount } = render(
    <EmptyStateVisualProvider
      render={({ defaultVisual }) => defaultVisual}
      accessory={(owner) => {
        coordinator = owner.presentation;
        return null;
      }}
    >
      <InteractionRegion>
        <ComposerAccessory />
      </InteractionRegion>
    </EmptyStateVisualProvider>,
  );
  const lease = coordinator!.claim("test");
  expect(lease.getSnapshot()).toBe(true);
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(lease.getSnapshot()).toBe(false);
  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(lease.getSnapshot()).toBe(true);
  unmount();
  expect(lease.getSnapshot()).toBe(false);
  lease.release();
  visibility.mockRestore();
});
