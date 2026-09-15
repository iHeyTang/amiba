import { expect, it } from "vitest";
import { userMessageText } from "./user-message-source";
import { DshAmibaEventBridge } from "./amiba-event-bridge";
import { projectRuntimeSessionHistory } from "../core/runtime-session-history";
import { formatFileAttachmentsForPrompt } from "../core/attachments/format";
const file = { type: "file", attachment: { attachmentId: "durable-hash", name: "notes.txt", bytes: 3 } };
it("preserves file-only plugin messages and duplicate occurrences live and after reload", () => {
  const event = { type: "user/message", seq: 9, time: 100, data: { id: "files", source: { kind: "plugin", plugin: "files", form: "relay" }, content: [file, file] } };
  const live = new DshAmibaEventBridge().accept({ rpcId: "r", payload: { type: "session/event", sessionId: "s", event } })[0]?.event;
  const history = projectRuntimeSessionHistory([{ event }]);
  const badges = userMessageText([file, file]).badges;
  expect(badges).toHaveLength(2);
  expect(badges[0].uiId).not.toBe(badges[1].uiId);
  expect(badges[0].attachmentId).toBeUndefined();
  expect(live).toMatchObject({ attachmentBadges: badges });
  expect(history[0]).toMatchObject({ attachmentBadges: badges });
});
it("uses official file references without generating custom metadata", () => {
  const native = { uiId: "n", attachmentId: "native-id", name: "notes.txt", size: 3, kind: "text" as const, mime: "text/plain" };
  const text = formatFileAttachmentsForPrompt([native]);
  const badges = userMessageText([{ type: "text", text }, file, file]).badges;
  expect(badges).toHaveLength(2);
  expect(text).toBe("");
  expect(badges[0]).toMatchObject({ name: "notes.txt", kind: "binary" });
  expect(badges[0].attachmentId).toBeUndefined();
});
it("ignores malformed references without hiding readable text", () => {
  for (const bad of [{ bytes: -1 }, { bytes: NaN }, { bytes: 1.5 }, { name: null }, { attachmentId: "" }]) {
    expect(userMessageText([{ ...file, attachment: { ...file.attachment, ...bad } }, { type: "text", text: "keep" }])).toEqual({ text: "keep", badges: [], images: [] });
  }
});
