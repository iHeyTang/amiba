import { expect, it } from "vitest";
import { visibleUserMessage } from "./user-message-source";
import { DshAmibaEventBridge } from "./amiba-event-bridge";
import { projectRuntimeSessionHistory } from "../core/runtime-session-history";

it("keeps per-message nicknames identical in live events and reloaded history", () => {
  const event = { type: "user/message", seq: 1, time: 2, data: { id: "nick-1", source: { kind: "plugin", plugin: "amiba-message:channel-ding", form: "relay", senderName: "张三" }, content: [{ type: "text", text: "你好" }] } };
  const bridge = new DshAmibaEventBridge();
  const live = bridge.accept({ rpcId: "rpc", payload: { type: "session/event", sessionId: "s", event } } as never)[0]?.event;
  const history = projectRuntimeSessionHistory([{ event }] as never);
  const origin = { kind: "plugin", plugin: "amiba-message:channel-ding", senderName: "张三" };
  expect(live).toMatchObject({ origin });
  expect(history[0]).toMatchObject({ origin });
});
it("does not fabricate names for legacy messages or treat nicknames as user identity", () => {
  expect(visibleUserMessage({ kind: "plugin", plugin: "relay", form: "relay" })).toEqual({ origin: { kind: "plugin", plugin: "relay" } });
  expect(visibleUserMessage({ kind: "plugin", plugin: "relay", form: "relay", senderName: 123 })).toEqual({ origin: { kind: "plugin", plugin: "relay" } });
  expect(visibleUserMessage({ kind: "user", senderName: "张三" })).toEqual({});
});
