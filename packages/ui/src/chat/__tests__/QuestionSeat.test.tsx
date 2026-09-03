import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuestionSeat } from "../bubble/question-seat";

const owner = {
  request: {
    requestId: "r1",
    questions: [{ id: "amiba.connect-wizard", question: "在下方完成平台接入" }],
  },
  inFlight: false,
  error: null,
  respond: vi.fn(),
  cancel: vi.fn(),
};

describe("QuestionSeat", () => {
  it("renders the fallback when no renderer is provided", () => {
    render(<QuestionSeat fallback={<div>banner</div>} owner={owner} />);
    expect(screen.getByText("banner")).toBeInTheDocument();
  });

  it("hands owner and fallback to the renderer and renders its result", () => {
    const render_ = vi.fn(({ owner: o, fallback }) => (
      <div>
        seat:{o.request.questions[0].id}
        {fallback}
      </div>
    ));
    render(
      <QuestionSeat
        fallback={<span>fb</span>}
        owner={owner}
        render={render_}
      />,
    );
    expect(screen.getByText(/seat:amiba\.connect-wizard/)).toBeInTheDocument();
    expect(screen.getByText("fb")).toBeInTheDocument();
    expect(render_).toHaveBeenCalledWith(expect.objectContaining({ owner }));
  });
});
