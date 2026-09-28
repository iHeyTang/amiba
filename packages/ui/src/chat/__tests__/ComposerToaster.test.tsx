import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ComposerDockSheet, ComposerToaster } from "../ComposerDockSheet";

describe("composer toaster ownership", () => {
  it("collects nested seats into one stack with fixed regions and a covered rear layer", () => {
    const respond = vi.fn();
    const view = render(<ComposerToaster>
      <ComposerDockSheet region="feedback">Error</ComposerDockSheet>
      <ComposerDockSheet><button onClick={respond}>Approve</button></ComposerDockSheet>
      <div><ComposerToaster>
        <ComposerDockSheet region="queue">Queued</ComposerDockSheet>
        <ComposerDockSheet region="context">Goal</ComposerDockSheet>
        <textarea aria-label="Composer" />
      </ComposerToaster></div>
    </ComposerToaster>);
    expect(view.container.querySelectorAll("[data-composer-toaster-stack]")).toHaveLength(1);
    expect(view.container.querySelector('[data-composer-toaster="persistent"]')).toHaveAttribute("inert");
    expect(view.container.querySelector('[data-composer-toaster="persistent"]')).toHaveAttribute("aria-hidden", "true");
    expect([...view.container.querySelectorAll("[data-composer-section]")].map(e => e.textContent)).toEqual(["Goal", "Queued", "Error", "Approve"]);
    expect(view.container.querySelector("[data-composer-toaster] textarea")).toBeNull();
    fireEvent.click(screen.getByText("Approve"));
    expect(respond).toHaveBeenCalledOnce();
  });

  it("uncovers the same queued draft after an interaction finishes", () => {
    function Fixture({ pending }: { pending: boolean }) {
      return <ComposerToaster>
        <ComposerDockSheet region="queue"><input aria-label="Queued draft" defaultValue="keep me" /></ComposerDockSheet>
        {pending && <ComposerDockSheet>Question</ComposerDockSheet>}
      </ComposerToaster>;
    }
    const view = render(<Fixture pending={false} />);
    const draft = screen.getByLabelText("Queued draft");
    fireEvent.change(draft, { target: { value: "edited queue" } });
    view.rerender(<Fixture pending />);
    expect(view.container.querySelector('[data-composer-toaster="persistent"]')).toHaveAttribute("inert");
    view.rerender(<Fixture pending={false} />);
    expect(view.container.querySelector('[data-composer-toaster="persistent"]')).not.toHaveAttribute("inert");
    expect(screen.getByLabelText("Queued draft")).toBe(draft);
    expect(draft).toHaveValue("edited queue");
  });

  it("preserves an interaction's local draft when other sections enter and leave", () => {
    function Question() {
      const [text, setText] = useState("");
      return <ComposerDockSheet><input aria-label="Answer" value={text} onChange={e => setText(e.target.value)} /></ComposerDockSheet>;
    }
    function Fixture({ error }: { error: boolean }) {
      return <ComposerToaster><Question />{error && <ComposerDockSheet region="feedback">Failed</ComposerDockSheet>}</ComposerToaster>;
    }
    const view = render(<Fixture error={false} />);
    const input = screen.getByLabelText("Answer");
    fireEvent.change(input, { target: { value: "keep this answer" } });
    view.rerender(<Fixture error />);
    view.rerender(<Fixture error={false} />);
    expect(screen.getByLabelText("Answer")).toBe(input);
    expect(input).toHaveValue("keep this answer");
    expect(view.container.querySelector('[data-composer-toaster-region="feedback"]')?.childElementCount).toBe(0);
  });
});
