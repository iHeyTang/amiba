import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Audit the exact installed rc.2 headless registration region before separating
// it from the official page. No React, DOM, slot or input service is supplied.
const bundle = readFileSync(
  "../../packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js",
  "utf8",
);
const begin = bundle.indexOf(
  "//#region lib/types/client/conversation-nodes/common.js",
);
const end = bundle.indexOf(
  "//#region lib/types/client/chat/use-throttled-visual-update.js",
  begin,
);
if (begin < 0 || end < 0)
  throw new Error("Official conversation registration region changed");
const register = Function(
  `${bundle.slice(begin, end)}; return registerConversationNodes;`,
)();
function definitions() {
  const events: any[] = [],
    fallbacks: any[] = [],
    views: any[] = [];
  register({
    conversationEvents: {
      register: (value: any) => events.push(value),
      registerFallback: (value: any) => fallbacks.push(value),
    },
    conversationViews: { register: (value: any) => views.push(value) },
  });
  return { events, fallbacks, views };
}
it("can register official business definitions without mounting the official UI", () => {
  const { events, fallbacks, views } = definitions();
  expect(events.map((value) => value.kind)).toContain("turn-tail");
  expect(events.map((value) => value.kind)).toContain("assistant-step");
  expect(new Set(events.map((value) => value.kind)).size).toBe(events.length);
  expect(fallbacks).toHaveLength(1);
  expect(views.map((value) => value.target)).toEqual(["chat"]);
});
it("keeps exact engine timeline references when the chat has no visible nodes", () => {
  const { views } = definitions();
  const builder = views[0].create();
  const timeline = { turnOrder: [], turns: new Map() };
  const snapshot = builder.replace({ nodes: [], timeline });
  expect(snapshot.timeline).toBe(timeline);
  expect(snapshot.order).toEqual([]);
});
