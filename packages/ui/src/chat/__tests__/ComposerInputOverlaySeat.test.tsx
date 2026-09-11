import { EmptyStateVisualProvider } from "../../primitives/empty-state-visual";
import { render } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

// The real editor is Lexical-backed and does not settle under jsdom; the seat
// under test is a sibling of it inside the composer card, so a stub keeps the
// rest of the composer mountable.
vi.mock("../composer/RichComposerEditor", () => ({
  RichComposerEditor: forwardRef(() => <div data-testid="rich-editor" />),
}));

import { Composer } from "../Composer";

function card(container: HTMLElement): HTMLElement {
  const frame = container.querySelector("[data-composer-card]");
  expect(frame).not.toBeNull();
  return frame as HTMLElement;
}

function renderComposer(props: { inputOverlay?: ReactNode } = {}) {
  return render(
    <Composer value="" onChange={() => {}} onSubmit={() => {}} {...props} />,
  );
}

/**
 * The official `conversation.input.overlay` seat (list, session scope, NO
 * owner share) — the composer's floating overlay anchor, where the official
 * trigger menu and command popup render upstream.
 *
 * Two things are contract rather than styling and both are asserted here:
 * the `[data-composer-card]` anchor must contain BOTH the editor and the
 * seat (occupants call `closest("[data-composer-card]")` on themselves to
 * tell a pointerdown inside the composer apart from one outside it), and an
 * unoccupied seat must cost nothing at all.
 */
describe("Composer conversation.input.overlay seat", () => {
  it("anchors the seat on the composer card that holds the editor", () => {
    const { container } = renderComposer({
      inputOverlay: <div data-input-overlay="" />,
    });

    const frame = card(container);
    const seat = container.querySelector("[data-input-overlay]");
    expect(seat).not.toBeNull();
    // The occupant positions itself against this box, so the seat must be a
    // DIRECT child of the anchor — a wrapper would become the positioned
    // ancestor instead and move the overlay off the card.
    expect(seat!.parentElement).toBe(frame);
    // `closest()` from the occupant must find the anchor, and the anchor must
    // also contain the editor for the inside/outside pointer test to mean
    // anything.
    expect(seat!.closest("[data-composer-card]")).toBe(frame);
    expect(frame.contains(container.querySelector('[data-testid="rich-editor"]')!)).toBe(
      true,
    );
    // Last child of the card: the seat never sits between the editor and the
    // tool row in reading order.
    expect(frame.lastElementChild).toBe(seat);
  });

  it("costs no box and no gap while the seat is empty", () => {
    const withoutSeat = renderComposer();
    const baseline = card(withoutSeat.container).innerHTML;
    withoutSeat.unmount();

    // A dispatched-but-unoccupied seat: the official renderSlot call for a
    // list slot with no registrant renders nothing. The card must be
    // byte-identical to a build with no seat at all — no wrapper element, no
    // placeholder, no extra flex gap.
    const withEmptySeat = renderComposer({ inputOverlay: null });
    expect(card(withEmptySeat.container).innerHTML).toBe(baseline);
  });

  it("keeps the anchor for surfaces that pass no seat at all", () => {
    // Quick-Ask and every other host outside a DSH plugin runtime pass no
    // renderer. The anchor attribute is still present (it is part of the
    // composer's own markup, not of the dispatch), so enabling a runtime
    // later needs no change on the surface side.
    const { container } = renderComposer();
    expect(container.querySelector("[data-composer-card]")).not.toBeNull();
  });
});

it("keeps persistent accessory content outside and below the menu anchor", () => {
  const { container } = render(<EmptyStateVisualProvider render={({defaultVisual}) => defaultVisual} accessory={() => <span data-test-accessory="" />}>
    <Composer value="" onChange={() => {}} onSubmit={() => {}} inputOverlay={<div data-input-overlay="" />} />
  </EmptyStateVisualProvider>);
  const frame = card(container);
  const accessory = container.querySelector('[data-composer-accessory]')!;
  expect(frame.contains(accessory)).toBe(false);
  expect(accessory.parentElement).toBe(frame.parentElement);
  expect(frame.compareDocumentPosition(accessory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelector('[data-input-overlay]')!.parentElement).toBe(frame);
});
