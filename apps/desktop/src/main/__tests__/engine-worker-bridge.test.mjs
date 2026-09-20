/**
 * Protocol test for the runtime-host worker link.
 *
 * Runs the real main-side bridge and the real worker-side runtime against each
 * other over a linked pair of ports with a stub engine, so the wire contract
 * (commands, frames, borrowed main services, activity pushes) is exercised
 * without Electron or a DSH runtime.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { EngineWorkerBridge } from "../chat-engine/worker-protocol.ts"
import { createEngineWorkerRuntime } from "../chat-engine/worker-runtime.ts"

/** Two ports linked in-process; delivery hops a microtask like a real channel. */
function linkedPorts() {
  const make = () => ({
    listeners: [],
    other: null,
    on(_event, listener) {
      this.listeners.push(listener)
    },
    postMessage(message) {
      const target = this.other
      queueMicrotask(() => {
        for (const listener of [...target.listeners]) listener(message)
      })
    },
  })
  const main = make()
  const worker = make()
  main.other = worker
  worker.other = main
  return { main, worker }
}

/** A stub engine that records what it was asked to do. */
function stubEngine({ host }) {
  const calls = []
  const activity = host.sessionActivity("s1")
  return {
    engine: {
      calls,
      host,
      activity,
      follow(sessionId, subagent) {
        calls.push(["follow", sessionId, subagent])
      },
      unfollow(sessionId) {
        calls.push(["unfollow", sessionId])
      },
      subscribe(sessionId) {
        calls.push(["subscribe", sessionId])
      },
      requestSnapshot(sessionId) {
        calls.push(["requestSnapshot", sessionId])
      },
      submit(payload) {
        calls.push(["submit", payload])
      },
      async submitWithReceipt(payload) {
        calls.push(["submitWithReceipt", payload])
        return { kind: "accepted", sessionId: payload.sessionId }
      },
      abort(sessionId) {
        calls.push(["abort", sessionId])
      },
      clear(sessionId) {
        calls.push(["clear", sessionId])
      },
      clearApproval(sessionId, approvalId) {
        calls.push(["clearApproval", sessionId, approvalId])
      },
      async respondToApproval() {
        return { ok: true }
      },
      async respondToQuestions() {
        return { ok: true }
      },
      async cancelQuestions() {
        return { ok: true }
      },
      dispose() {
        calls.push(["dispose"])
      },
    },
  }
}

function harness({ handleRequest = async () => null } = {}) {
  const { main, worker } = linkedPorts()
  let resolveReady
  const ready = new Promise((resolve) => {
    resolveReady = resolve
  })
  const batches = []
  let made
  const runtime = createEngineWorkerRuntime({
    port: worker,
    createEngine: (host) => {
      made = stubEngine({ host })
      return made.engine
    },
  })
  const bridge = new EngineWorkerBridge({
    port: main,
    onFrames: (messages) => batches.push(messages),
    handleRequest,
    onReady: () => resolveReady(),
  })
  return { bridge, runtime, ready, batches, engine: () => made.engine }
}

test("init builds the engine and commands reach it", async () => {
  const h = harness()
  h.bridge.init({ baseUrl: "http://dsh.test", browserCookie: "cookie=abc" })
  await h.ready

  const subagent = { parentSessionId: "p", childSessionId: "c", mode: "one-shot" }
  await h.bridge.command({ verb: "follow", sessionId: "s1", subagent })
  await h.bridge.command({ verb: "subscribe", sessionId: "s1" })
  await h.bridge.command({ verb: "abort", sessionId: "s1" })

  assert.deepEqual(h.engine().calls, [
    ["follow", "s1", subagent],
    ["subscribe", "s1"],
    ["abort", "s1"],
  ])
})

test("commands that answer carry their result back to main", async () => {
  const h = harness()
  h.bridge.init({ baseUrl: "http://dsh.test" })
  await h.ready

  const receipt = await h.bridge.command({
    verb: "submitWithReceipt",
    payload: { sessionId: "s1" },
  })
  assert.deepEqual(receipt, { kind: "accepted", sessionId: "s1" })
})

test("a failing command rejects in main with the worker's message", async () => {
  const h = harness()
  h.bridge.init({ baseUrl: "http://dsh.test" })
  await h.ready
  h.engine().requestSnapshot = () => {
    throw new Error("engine exploded")
  }

  await assert.rejects(
    h.bridge.command({ verb: "requestSnapshot", sessionId: "s1" }),
    /engine exploded/,
  )
})

test("frames from one tick cross the process boundary as one batch, in order", async () => {
  const h = harness()
  h.bridge.init({ baseUrl: "http://dsh.test" })
  await h.ready

  h.engine().host.emitFrame({ type: "event", sessionId: "s1", event: { seq: 1 } })
  h.engine().host.emitFrame({ type: "event", sessionId: "s1", event: { seq: 2 } })
  await new Promise((resolve) => setTimeout(resolve, 40))

  // One hop for both frames — not one per delta.
  assert.equal(h.batches.length, 1)
  assert.deepEqual(
    h.batches[0].map((frame) => frame.event.seq),
    [1, 2],
  )
})

test("frames from different ticks arrive as separate batches", async () => {
  const h = harness()
  h.bridge.init({ baseUrl: "http://dsh.test" })
  await h.ready

  h.engine().host.emitFrame({ type: "event", sessionId: "s1", event: { seq: 1 } })
  await new Promise((resolve) => setTimeout(resolve, 40))
  h.engine().host.emitFrame({ type: "event", sessionId: "s1", event: { seq: 2 } })
  await new Promise((resolve) => setTimeout(resolve, 40))

  assert.deepEqual(
    h.batches.map((batch) => batch.map((frame) => frame.event.seq)),
    [[1], [2]],
  )
})

test("the worker borrows main's services, and a rejection is reported", async () => {
  const seen = []
  const h = harness({
    handleRequest: async (request) => {
      seen.push(request)
      if (request.kind === "serializeDrafts") throw new Error("no drafts")
      return { cwd: "/tmp/work", workspaceId: "w1" }
    },
  })
  h.bridge.init({ baseUrl: "http://dsh.test" })
  await h.ready

  const resolved = await h.engine().host.request({
    kind: "resolveSession",
    sessionId: "s1",
  })
  assert.deepEqual(resolved, { cwd: "/tmp/work", workspaceId: "w1" })
  await assert.rejects(
    h.engine().host.request({
      kind: "serializeDrafts",
      sessionId: "s1",
      ids: ["d1"],
    }),
    /no drafts/,
  )
  assert.deepEqual(seen, [
    { kind: "resolveSession", sessionId: "s1" },
    { kind: "serializeDrafts", sessionId: "s1", ids: ["d1"] },
  ])
})

test("activity pushes from main update the engine's sessionActivity view", async () => {
  const h = harness()
  h.bridge.init({ baseUrl: "http://dsh.test" })
  await h.ready

  let notifications = 0
  h.engine().activity.subscribe(() => {
    notifications += 1
  })
  assert.equal(h.engine().activity.getSnapshot().running, false)

  h.bridge.notifyActivity("s1", true)
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(h.engine().activity.getSnapshot().running, true)
  assert.equal(notifications, 1)
})

test("dispose closes the engine and rejects in-flight commands", async () => {
  const h = harness()
  h.bridge.init({ baseUrl: "http://dsh.test" })
  await h.ready

  h.engine().submitWithReceipt = () => new Promise(() => {})
  const inFlight = h.bridge.command({
    verb: "submitWithReceipt",
    payload: { sessionId: "s1" },
  })
  h.bridge.dispose()
  await assert.rejects(inFlight, /closed/)
})

test("subagent addresses are pushed to the worker and read synchronously", async () => {
  const h = harness()
  h.bridge.init({ baseUrl: "http://dsh.test" })
  await h.ready

  assert.equal(h.engine().host.subagentAddress("s1"), undefined)
  const address = { parentSessionId: "p", childSessionId: "c", mode: "continuable" }
  h.bridge.notifySubagents({ s1: address })
  // Delivery hops the channel like any other push; the *read* is synchronous —
  // the engine asks during submit/abort and must not wait on a round trip.
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(h.engine().host.subagentAddress("s1"), address)
})
