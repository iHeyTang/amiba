import { describe, expect, it } from "vitest";
import { userMessageText } from "./user-message-source";
import { DshAmibaEventBridge } from "./amiba-event-bridge";
import { projectRuntimeSessionHistory } from "../core/runtime-session-history";

const image = {
  attachmentId: "durable-image",
  mediaType: "image/png",
  bytes: 123,
  width: 12,
  height: 34,
  name: "capture.png",
  originalDimensions: { width: 24, height: 68 },
};
const block = { type: "image", attachment: image };

describe("durable message image projection", () => {
  it("keeps image occurrences in content order without changing readable text", () => {
    const second = { ...image, attachmentId: "second" };
    const result = userMessageText([
      { type: "text", text: "before" }, block,
      { type: "text", text: "after" }, { type: "image", attachment: second }, block,
    ]);
    expect(result.text).toBe("before\nafter");
    expect(result.images).toEqual([{ attachment: image }, { attachment: second }, { attachment: image }]);
    expect(result.badges).toEqual([]);
  });
  it("does not manufacture durable identities from staging metadata or inline bytes", () => {
    expect(userMessageText([
      { type: "image", mediaType: "image/png", data: "AAAA" },
      { type: "image", attachment: { attachmentId: "staging-id" } },
      { type: "text", text: "literal attachmentId=durable-image" },
    ])).toEqual({ text: "literal attachmentId=durable-image", badges: [], images: [] });
  });
  it.each([
    { width: 0 }, { height: -1 }, { bytes: NaN }, { bytes: 1.5 },
    { attachmentId: "" }, { mediaType: "text/html" }, { mediaType: ["image/png"] }, { name: 12 },
    { originalDimensions: { width: 1, height: 0 } },
  ])("ignores a malformed image but preserves adjacent valid content: %j", (invalid) => {
    const result = userMessageText([{ type: "image", attachment: { ...image, ...invalid } }, block]);
    expect(result.images).toEqual([{ attachment: image }]);
  });
  it("preserves the same image-only plugin message in live and reloaded history", () => {
    const event = {
      type: "user/message", seq: 9, time: 100,
      data: { id: "photo-message", role: "user", source: { kind: "plugin", plugin: "photo-provider", form: "relay" }, content: [block] },
    };
    const live = new DshAmibaEventBridge().accept({ rpcId: "rpc", payload: { type: "session/event", sessionId: "s", event } })[0]?.event;
    const history = projectRuntimeSessionHistory([{ event }]);
    expect(live).toMatchObject({ kind: "userMessage", uiId: "dsh:photo-message", content: "", images: [{ attachment: image }] });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ uiId: "dsh:photo-message", content: "", images: [{ attachment: image }] });
  });
  it("retains personal message images on reload while leaving the native optimistic echo policy intact", () => {
    const event = { type: "user/message", seq: 2, time: 10, data: { id: "user-photo", source: { kind: "user" }, content: [block] } };
    expect(projectRuntimeSessionHistory([{ event }])[0]?.images).toEqual([{ attachment: image }]);
    expect(new DshAmibaEventBridge().accept({ rpcId: "r", payload: { type: "session/event", sessionId: "s", event } })).toEqual([]);
  });
});
