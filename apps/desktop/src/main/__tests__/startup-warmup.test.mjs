import assert from "node:assert/strict"
import test from "node:test"

import { runStartupWarmup } from "../startup-warmup.ts"

const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test("waits for every target before reporting completion", async () => {
  const order = []
  const slow = deferred()
  const running = runStartupWarmup(
    [
      { label: "pet", boot: () => void order.push("pet") },
      {
        label: "quick-ask",
        boot: async () => {
          order.push("quick-ask")
          await slow.promise
          order.push("quick-ask:done")
        },
      },
    ],
    500,
  )
  // Both boots start in parallel…
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(order, ["pet", "quick-ask"])
  // …and completion waits for the slow one rather than resolving early.
  slow.resolve()
  const result = await running
  assert.deepEqual(order, ["pet", "quick-ask", "quick-ask:done"])
  assert.equal(result.completed, true)
  assert.deepEqual(result.pending, [])
})

test("a target that never settles is bounded by the timeout, not awaited forever", async () => {
  const result = await runStartupWarmup(
    [
      { label: "pet", boot: () => {} },
      { label: "quick-ask", boot: () => new Promise(() => {}) },
    ],
    40,
  )
  assert.equal(result.completed, false)
  assert.deepEqual(result.pending, ["quick-ask"])
})

test("a failing target is reported and does not block the reveal", async () => {
  const result = await runStartupWarmup(
    [
      { label: "pet", boot: () => { throw new Error("boom") } },
      { label: "quick-ask", boot: () => {} },
    ],
    500,
  )
  assert.equal(result.completed, true)
  assert.deepEqual(result.pending, [])
})
