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
  RichComposerEditor: forwardRef((_props: { value: string }, _ref) => <div data-testid="rich-editor" data-draft={_props.value} />),
}));

import { Composer } from "../Composer";

function card(container: HTMLElement): HTMLElement {
  const frame = container.querySelector("[data-composer-card]");
  expect(frame).not.toBeNull();
  return frame as HTMLElement;
}

function renderComposer(props: { inputOverlay?: ReactNode; inputDock?: ReactNode; composerDock?: ReactNode; inputLeft?: ReactNode; inputRight?: ReactNode; actionsLeft?: ReactNode } = {}) {
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

describe("additive official input regions", () => {
  it("keeps docks outside the card and controls in the existing tool row", () => {
    const { container } = renderComposer({
      inputDock: <div data-region="above"/>, composerDock: <div data-region="below"/>,
      inputLeft: <span data-region="left"/>, inputRight: <span data-region="right"/>,
      actionsLeft: <span data-region="native"/>,
    });
    const frame = card(container);
    const region = (name: string) => container.querySelector(`[data-region="${name}"]`)!;
    expect(region("above").parentElement).toBe(frame.parentElement);
    expect(region("below").parentElement).toBe(frame.parentElement);
    expect(region("above").compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(frame.compareDocumentPosition(region("below")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region("left").previousElementSibling).toBe(region("native"));
    expect(frame.contains(region("left"))).toBe(true);
    expect(frame.contains(region("right"))).toBe(true);
    expect(region("right").nextElementSibling?.tagName).toBe("BUTTON");
  });
  it("adds no markup for dispatched empty regions", () => {
    const Empty = () => null;
    const view = renderComposer();
    const baseline = view.container.innerHTML;
    view.rerender(<Composer value="" onChange={() => {}} onSubmit={() => {}} inputDock={<Empty/>} composerDock={<Empty/>} inputLeft={<Empty/>} inputRight={<Empty/>}/>);
    expect(view.container.innerHTML).toBe(baseline);
  });
});


describe("composer attachment gallery", () => {
  it("renders one unified gallery for staged attachments and keeps pinned chips", () => {
    const attachments = {
      attachments: [
        { uiId: "img-1", kind: "image", name: "photo.png", mime: "image/png", size: 10, thumbDataUrl: "blob:thumb-1", previewDataUrl: "blob:preview-1" },
        { uiId: "pdf-1", kind: "pdf", name: "a.pdf", mime: "application/pdf", size: 12 },
      ],
      draftImages: [], canAddDraftImages: () => true,
      fileInputProps: { type: "file" }, removeAttachment: () => {},
    } as never;
    const props = { value: "", onChange: () => {}, onSubmit: () => {}, attachments,
      permissionSessionId: "a", chipRow: <span data-native-chip="" />,
    };
    const { container } = render(<Composer {...props} />);
    const frame = card(container);
    expect(frame.querySelector("[data-native-chip]")).not.toBeNull();
    const gallery = frame.querySelector("[data-attachment-gallery]");
    expect(gallery).not.toBeNull();
    expect(gallery!.textContent).toContain("a.pdf");
    // Images render as bounded preview tiles (name rides on the img alt),
    // files as compact chips — one shared gallery, no separate capsule row.
    const img = gallery!.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("photo.png");
  });

  it("renders no gallery row when nothing is staged", () => {
    const props = { value: "", onChange: () => {}, onSubmit: () => {} };
    const { container } = render(<Composer {...props} />);
    expect(card(container).querySelector("[data-attachment-gallery]")).toBeNull();
  });
});

describe("official attachment presentation", () => {
  it("passes file drafts and upload failures through the real add/remove/retry paths", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const addFiles = vi.fn(async () => {});
    const removeAttachment = vi.fn();
    const retryFileUpload = vi.fn();
    const draft = { kind: "file" as const, id: "draft-file", file };
    const uploads = { "draft-file": { status: "error" as const, message: "offline" } };
    const attachments = {
      attachments: [{ uiId: "chip-file", attachmentId: "draft-file", kind: "file", name: "notes.txt" }],
      draftImages: [draft], getDraftImages: () => [draft], fileUploads: uploads,
      attachmentBusy: false, attachmentUploading: false, addFiles, removeAttachment, retryFileUpload,
      dropHandlers: {}, fileInputProps: { type: "file", className: "hidden" },
    } as unknown as import("../useComposerAttachments").UseComposerAttachmentsResult;
    let owner!: import("@amiba/extension-sdk").ComposerAttachmentsOwner;
    const renderAttachments: import("../Composer").ComposerAttachmentsRenderer = (value, fallback) => { owner = value; return fallback; };
    const view = render(<Composer value="" onChange={() => {}} onSubmit={() => {}} attachments={attachments} renderAttachments={renderAttachments} />);
    expect(owner.attachments).toEqual([draft]);
    expect(owner.uploads).toBe(uploads);
    expect(owner.canAcceptDrop).toBe(true);
    owner.onAddFiles([file]);
    owner.onRemoveAttachment(draft.id as never);
    owner.onRetryFile(draft.id as never);
    expect(addFiles).toHaveBeenCalledWith([file]);
    expect(removeAttachment).toHaveBeenCalledWith("chip-file");
    expect(retryFileUpload).toHaveBeenCalledWith("draft-file");
    view.rerender(<Composer value="" onChange={() => {}} onSubmit={() => {}} disabled attachments={attachments} renderAttachments={renderAttachments} />);
    expect(owner.canAcceptDrop).toBe(false);
    owner.onAddFiles([file]); owner.onRemoveAttachment(draft.id as never); owner.onRetryFile(draft.id as never);
    expect(addFiles).toHaveBeenCalledTimes(1);
    expect(removeAttachment).toHaveBeenCalledTimes(1);
    expect(retryFileUpload).toHaveBeenCalledTimes(1);
  });
});

describe("official composer bar replacement", () => {
  it("passes actual variant, disabled state and placeholder, and restores the current draft", () => {
    const renderBar = vi.fn((_owner, _fallback) => <div data-testid="replacement">replacement</div>);
    const base = { value: "retained draft", onChange: vi.fn(), onSubmit: vi.fn(), placeholder: "Write here" };
    const view = render(<Composer {...base} frameVariant="hero" disabled renderBar={renderBar} />);
    expect(renderBar.mock.calls.at(-1)?.[0]).toEqual({ variant: "hero", disabled: true, placeholder: "Write here" });
    expect(view.queryByTestId("rich-editor")).toBeNull();
    view.rerender(<Composer {...base} renderBar={(owner, fallback) => {
      expect(owner.variant).toBe("composer");
      expect(owner.disabled).toBe(false);
      return fallback;
    }} />);
    expect(view.getByTestId("rich-editor").getAttribute("data-draft")).toBe("retained draft");
    expect(base.onChange).not.toHaveBeenCalled();
    expect(base.onSubmit).not.toHaveBeenCalled();
  });

  it("honors deliberate null instead of resurrecting the native bar", () => {
    const view = render(<Composer value="draft" onChange={vi.fn()} onSubmit={vi.fn()} renderBar={() => null} />);
    expect(view.container.textContent).toBe("");
    expect(view.queryByTestId("rich-editor")).toBeNull();
  });
});
