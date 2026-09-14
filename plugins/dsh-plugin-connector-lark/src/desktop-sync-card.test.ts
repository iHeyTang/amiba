import { expect, it } from "vitest";
import { desktopSyncCard } from "./desktop-sync-card.js";

it("keeps user text literal, with origin and role in a separate header", () => {
  const text = "**literal** <at id=all></at>\n用户 · 来自桌面端\n\nbody";
  const card = desktopSyncCard(`用户 · 来自桌面端\n\n${text}`, "user");
  expect(card.header).toEqual({ title: { tag: "plain_text", content: "💻 桌面同步 · 用户消息" }, template: "grey" });
  expect(card.body.elements).toEqual([{ tag: "div", text: { tag: "plain_text", content: text } }]);
});

it("preserves assistant markdown including lists, links and code", () => {
  const text = "**状态**\n- [文档](https://example.com)\n```ts\nconst ok = true;\n```";
  expect(desktopSyncCard(`助手 · 来自桌面端\n\n${text}`, "assistant").body.elements)
    .toEqual([{ tag: "markdown", content: text }]);
  expect(desktopSyncCard(text, "assistant").body.elements)
    .toEqual([{ tag: "markdown", content: text }]);
});
