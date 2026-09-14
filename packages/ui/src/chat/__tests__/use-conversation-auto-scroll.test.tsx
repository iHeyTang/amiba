import { fireEvent, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useConversationAutoScroll } from "../use-conversation-auto-scroll";

function setup() {
  const viewport = document.createElement("div");
  let height = 1000;
  let top = 0;
  Object.defineProperties(viewport, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => 400 },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, height - 400));
      },
    },
  });
  const ref = { current: viewport };
  const hook = renderHook(
    ({ sessionId, content, clearance }) =>
      useConversationAutoScroll(ref, sessionId, content, clearance),
    { initialProps: { sessionId: "first", content: 0, clearance: 60 } },
  );
  return {
    viewport,
    rerender: hook.rerender,
    grow: () => {
      height += 100;
    },
  };
}

it("follows output, pauses even a small upward scroll, and resumes at the bottom", () => {
  const { viewport, grow, rerender } = setup();
  expect(viewport.scrollTop).toBe(600);
  grow();
  rerender({ sessionId: "first", content: 1, clearance: 60 });
  expect(viewport.scrollTop).toBe(700);
  viewport.scrollTop = 690;
  fireEvent.scroll(viewport);
  grow();
  rerender({ sessionId: "first", content: 2, clearance: 60 });
  expect(viewport.scrollTop).toBe(690);
  // Resizing the composer must also leave the reader's position alone.
  rerender({ sessionId: "first", content: 2, clearance: 180 });
  expect(viewport.scrollTop).toBe(690);
  viewport.scrollTop = viewport.scrollHeight;
  fireEvent.scroll(viewport);
  grow();
  rerender({ sessionId: "first", content: 3, clearance: 180 });
  expect(viewport.scrollTop).toBe(900);
});

it("pauses on wheel intent before scroll arrives and resets for another conversation", () => {
  const { viewport, grow, rerender } = setup();
  fireEvent.wheel(viewport, { deltaY: -10 });
  fireEvent.scroll(viewport); // A queued programmatic scroll at the old position.
  grow();
  rerender({ sessionId: "first", content: 1, clearance: 60 });
  expect(viewport.scrollTop).toBe(600);
  rerender({ sessionId: "second", content: 2, clearance: 60 });
  expect(viewport.scrollTop).toBe(700);
});
