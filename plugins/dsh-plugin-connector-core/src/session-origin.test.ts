import { describe, expect, it } from "vitest";
import { externalSessionChannel } from "./session-origin.js";
const relay = { type: "user/message", data: { source: { kind: "plugin", plugin: "amiba-message:channel-lark", form: "relay" } } };
describe("external session origin", () => {
  it("recognizes a relay after header events, but never a later relay in a local conversation", () => {
    expect(externalSessionChannel([{ type: "session/title" }, relay])).toBe("channel-lark");
    expect(externalSessionChannel([{ type: "user/message", data: { source: { kind: "user" } } }, relay])).toBeNull();
    expect(externalSessionChannel([{ type: "user/message", data: { source: { kind: "plugin", plugin: "steward" } } }])).toBeNull();
    expect(externalSessionChannel([])).toBeUndefined();
  });
});
