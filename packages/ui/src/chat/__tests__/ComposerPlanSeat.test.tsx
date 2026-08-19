import { render } from "@testing-library/react";
import { forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ComposerPlanSeatRenderer } from "../Composer";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

// The real editor is Lexical-backed and does not settle under jsdom; the
// seat under test lives in the tool row below it, so a stub keeps the rest
// of the composer mountable.
vi.mock("../composer/RichComposerEditor", () => ({
  RichComposerEditor: forwardRef(() => <div data-testid="rich-editor" />),
}));

// Stands in for the access-mode (permission preset) control — the resident
// chrome the official contract places the plan seat immediately right of.
vi.mock("../ComposerApprovalModePicker", () => ({
  ComposerApprovalModePicker: () => (
    <button data-access-mode="" type="button">
      access-mode
    </button>
  ),
}));

import { Composer } from "../Composer";

function toolRow(container: HTMLElement): HTMLElement {
  const accessMode = container.querySelector("[data-access-mode]");
  expect(accessMode).not.toBeNull();
  return accessMode!.parentElement as HTMLElement;
}

function renderComposer(
  props: { planSeat?: ComposerPlanSeatRenderer; disabled?: boolean } = {},
) {
  return render(
    <Composer
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      approvalModePicker
      {...props}
    />,
  );
}

/**
 * The official `conversation.input.plan` seat (single, session scope, owner
 * `InputControlOwnerProps { locked }`). Amiba has no occupant today — the
 * official ui-plan package is disabled — so the empty-seat behaviour is the
 * behaviour that ships: the contract says an unoccupied seat "renders
 * nothing at all — the bar paints no placeholder, so an absent plan plugin
 * costs no layout".
 */
describe("Composer conversation.input.plan seat", () => {
  it("costs no layout while the seat is empty", () => {
    const withoutSeat = renderComposer();
    const baseline = toolRow(withoutSeat.container).innerHTML;
    withoutSeat.unmount();

    // A dispatched-but-unoccupied seat: the official renderSlot call for a
    // single slot with no registrant renders nothing. The tool row must be
    // byte-identical to a build with no seat at all — no wrapper element,
    // no placeholder, no extra flex gap.
    const withEmptySeat = renderComposer({ planSeat: () => null });
    expect(toolRow(withEmptySeat.container).innerHTML).toBe(baseline);
  });

  it("renders the occupant immediately right of the access-mode control", () => {
    const { container } = renderComposer({
      planSeat: (owner) => (
        <span data-plan-seat="">{`locked:${owner.locked}`}</span>
      ),
    });

    const accessMode = container.querySelector("[data-access-mode]");
    const seat = container.querySelector("[data-plan-seat]");
    expect(seat).not.toBeNull();
    // Placement per the seat's own contract: the named plan seat sits in
    // the composer tool row immediately right of the access-mode control.
    expect(accessMode!.nextElementSibling).toBe(seat);
    expect(seat!.parentElement).toBe(toolRow(container));
  });

  it("passes the official locked-only owner share", () => {
    const owners: Array<{ locked: boolean }> = [];
    const seat: ComposerPlanSeatRenderer = (owner) => {
      owners.push({ ...owner });
      return <span data-plan-seat="" />;
    };

    const live = renderComposer({ planSeat: seat });
    live.unmount();
    renderComposer({ planSeat: seat, disabled: true });

    // `locked` is the composer's chrome disable state — the same source the
    // model seat's owner share reads, and the ONLY member the contract
    // defines (everything else comes from the framework session kit).
    expect(owners.map((owner) => owner.locked)).toEqual([false, true]);
    expect(owners.every((owner) => Object.keys(owner).length === 1)).toBe(true);
  });
});
