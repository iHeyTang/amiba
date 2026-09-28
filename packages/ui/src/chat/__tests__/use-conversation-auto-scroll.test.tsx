import { fireEvent, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useConversationAutoScroll } from "../use-conversation-auto-scroll";

function setup(scope = {}, turnOffset?: number) {
  const viewport = document.createElement("div");
  let height = 1000;
  let top = 0;
  let currentTurnOffset = turnOffset ?? 0;
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
  if (turnOffset !== undefined) {
    const turn = document.createElement("div");
    turn.dataset.conversationUserTurn = "saved-turn";
    turn.getBoundingClientRect = () => ({ top: currentTurnOffset - top, bottom: currentTurnOffset - top + 600 }) as DOMRect;
    viewport.append(turn);
  }
  const ref = { current: viewport };
  const hook = renderHook(
    ({ sessionId, content, clearance }) =>
      useConversationAutoScroll(ref, sessionId, content, clearance, { scope }),
    { initialProps: { sessionId: "first", content: 0, clearance: 60 } },
  );
  return {
    viewport,
    moveTurn: (offset: number) => { currentTurnOffset = offset; },
    unmount: hook.unmount,
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

it('yields scroll writes to an official transcript and resumes without forcing a reader to the bottom', () => {
  const viewport = document.createElement('div');
  Object.defineProperties(viewport, { scrollHeight: { value: 1000 }, clientHeight: { value: 400 } });
  const ref = { current: viewport };
  const hook = renderHook(({ enabled, content }) => useConversationAutoScroll(ref, 'same', content, 60, { enabled }), { initialProps: { enabled: true, content: 0 } });
  viewport.scrollTop = 200; fireEvent.scroll(viewport);
  hook.rerender({ enabled: false, content: 1 });
  expect(viewport.scrollTop).toBe(200);
  hook.rerender({ enabled: true, content: 2 });
  expect(viewport.scrollTop).toBe(200);
});

it('does not assume the replacement reader is following when no scroll event was delivered', () => {
  const viewport = document.createElement('div');
  Object.defineProperties(viewport, { scrollHeight: { value: 1000 }, clientHeight: { value: 400 } });
  viewport.scrollTop = 200;
  const ref = { current: viewport };
  const hook = renderHook(({ enabled }) => useConversationAutoScroll(ref, 'same', 0, 60, { enabled }), { initialProps: { enabled: false } });
  hook.rerender({ enabled: true });
  expect(viewport.scrollTop).toBe(200);
});

it("restores each conversation and does not follow output while reading history", () => {
  const { viewport, grow, rerender } = setup();
  viewport.scrollTop = 120;
  fireEvent.scroll(viewport);
  rerender({ sessionId: "second", content: 0, clearance: 60 });
  expect(viewport.scrollTop).toBe(600);
  grow();
  rerender({ sessionId: "first", content: 1, clearance: 60 });
  expect(viewport.scrollTop).toBe(120);
  grow();
  rerender({ sessionId: "first", content: 2, clearance: 60 });
  expect(viewport.scrollTop).toBe(120);
});

it("restores a reading position after the conversation view is unmounted", () => {
  const scope = {};
  const first = setup(scope);
  first.viewport.scrollTop = 240;
  fireEvent.scroll(first.viewport);
  first.unmount();
  const reopened = setup(scope);
  expect(reopened.viewport.scrollTop).toBe(240);
});

it("waits for content height before completing restoration", () => {
  const scope = {};
  const first = setup(scope);
  first.grow(); first.grow(); first.grow();
  first.viewport.scrollTop = 800;
  fireEvent.scroll(first.viewport);
  // Move up to mark this as history reading, not following the bottom.
  first.viewport.scrollTop = 790;
  fireEvent.scroll(first.viewport);
  first.unmount();
  const reopened = setup(scope);
  expect(reopened.viewport.scrollTop).toBe(600);
  reopened.grow(); reopened.grow();
  reopened.rerender({ sessionId: "first", content: 1, clearance: 60 });
  expect(reopened.viewport.scrollTop).toBe(790);
});

it("restores the same message offset when content above it changes height", () => {
  const scope = {};
  const first = setup(scope, 100);
  first.viewport.scrollTop = 180;
  fireEvent.scroll(first.viewport);
  first.unmount();
  const reopened = setup(scope, 220);
  expect(reopened.viewport.scrollTop).toBe(300);
});

it("saves the actual visible anchor when history layout changes without a scroll event", () => {
  const scope = {};
  const first = setup(scope, 100);
  first.viewport.scrollTop = 180;
  fireEvent.scroll(first.viewport);
  first.moveTurn(220);
  first.rerender({sessionId:"first",content:1,clearance:60});
  first.unmount();
  const reopened = setup(scope, 220);
  expect(reopened.viewport.scrollTop).toBe(180);
  reopened.unmount();
});

it("owns anchoring only while restoring history and releases it for reader scrolling or cleanup", () => {
  const scope = {};
  const first = setup(scope, 100);
  first.viewport.scrollTop = 180;
  fireEvent.scroll(first.viewport);
  first.unmount();
  const reopened = setup(scope, 220);
  expect(reopened.viewport.style.overflowAnchor).toBe("none");
  fireEvent.wheel(reopened.viewport, {deltaY:-1});
  expect(reopened.viewport.style.overflowAnchor).toBe("");
  reopened.unmount();
  const returned = setup(scope, 220);
  expect(returned.viewport.style.overflowAnchor).toBe("none");
  returned.unmount();
  expect(returned.viewport.style.overflowAnchor).toBe("");
});

it("releases anchor ownership when an official transcript takes over during restoration", () => {
  const viewport = document.createElement("div");
  Object.defineProperties(viewport, {scrollHeight:{value:1000}, clientHeight:{value:400}});
  const turn = document.createElement("div");
  turn.dataset.conversationUserTurn = "reader";
  turn.getBoundingClientRect = () => ({top:100-viewport.scrollTop, bottom:700-viewport.scrollTop}) as DOMRect;
  viewport.append(turn);
  const ref = {current:viewport}, scope = {};
  const hook = renderHook(({sessionId, enabled}) => useConversationAutoScroll(ref,sessionId,0,60,{scope,enabled}), {
    initialProps:{sessionId:"first",enabled:true},
  });
  viewport.scrollTop=180; fireEvent.scroll(viewport);
  hook.rerender({sessionId:"second",enabled:true});
  hook.rerender({sessionId:"first",enabled:true});
  expect(viewport.style.overflowAnchor).toBe("none");
  hook.rerender({sessionId:"first",enabled:false});
  expect(viewport.style.overflowAnchor).toBe("");
  hook.rerender({sessionId:"first",enabled:true});
  expect(viewport.style.overflowAnchor).toBe("");
  hook.unmount();
});
