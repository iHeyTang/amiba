import assert from "node:assert/strict"
import test from "node:test"

import { createFrameBatcher } from "../frame-batcher.ts"

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

test("holds frames for one tick and flushes them together, in order", async () => {
  const flushes = []
  const batcher = createFrameBatcher((items) => flushes.push(items), 10)
  batcher.push("a")
  batcher.push("b")
  batcher.push("c")
  assert.deepEqual(flushes, []) // nothing synchronous: the tick owns the flush
  await tick()
  assert.deepEqual(flushes, [["a", "b", "c"]])
})

test("a frame arriving after a flush opens a new batch", async () => {
  const flushes = []
  const batcher = createFrameBatcher((items) => flushes.push(items), 10)
  batcher.push("a")
  await tick()
  batcher.push("b")
  await tick()
  assert.deepEqual(flushes, [["a"], ["b"]])
})

test("flush() sends immediately, so a closing window is not left waiting", () => {
  const flushes = []
  const batcher = createFrameBatcher((items) => flushes.push(items), 10_000)
  batcher.push("a")
  batcher.push("b")
  batcher.flush()
  assert.deepEqual(flushes, [["a", "b"]])
  // Nothing was left scheduled: a second flush is a no-op.
  batcher.flush()
  assert.deepEqual(flushes, [["a", "b"]])
})

test("dispose() drops buffered frames instead of sending them", async () => {
  const flushes = []
  const batcher = createFrameBatcher((items) => flushes.push(items), 10)
  batcher.push("a")
  batcher.dispose()
  await tick()
  assert.deepEqual(flushes, [])
})
