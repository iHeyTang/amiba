import { describe, it, expect } from "vitest"
import { DshAmibaEventBridge } from "./amiba-event-bridge"
import { projectRuntimeSessionHistory } from "../core/runtime-session-history"
import { presentationNotice } from "./user-message-source"

describe("presentation notice protocol", () => {
  const data = { version: 1, id: "n1", source: "any-producer", summary: "Finished", body: "Saved result", placement: {kind:"execution",sessionId:"s1",callId:"call-1"}, reference: { kind: "custom-entity", sessionId: "s1", id: "entity-2", instance: "generation-1" } }
  it("projects the same identity and opaque reference live and on reload", () => {
    const event = { type: "amiba/notice", seq: 4, time: 123, data }
    const live = new DshAmibaEventBridge().accept({ rpcId: "rpc", payload: { type: "session/event", sessionId: "s1", event } })[0]!.event
    const history = projectRuntimeSessionHistory([{event}])[0]!
    const projected = presentationNotice(data)!
    expect(live).toEqual({ kind: "userMessage", ...projected, sentAt: 123 })
    expect(history).toEqual({ role: "user", ...projected, runtimeSeq: 4, sentAt: 123 })
    expect(history.notice?.reference).toEqual(data.reference)
    expect(history.notice?.placement).toEqual(data.placement)
  })
  it.each([{version:2}, {reference:{id:"x"}}, {reference:null}, {source:""}, {body:42}, {placement:{kind:"execution",sessionId:"s1"}}, {placement:{kind:"unknown"}}, {placement:null}])("drops malformed envelopes %j", override => {
    expect(presentationNotice({...data,...override})).toBeNull()
  })
})
