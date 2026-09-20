import assert from "node:assert/strict"
import test from "node:test"

import {
  isShellReady,
  markShellReady,
  whenShellReady,
} from "../shell-ready.ts"

// The latch is module-global and one-shot by design, so this test walks the
// whole lifecycle in one place instead of trying to reset it between cases.
test("the shell latch times out cold, then resolves every later waiter", async () => {
  assert.equal(isShellReady(), false)

  // Nobody reported yet: a consumer gives up rather than waiting forever.
  assert.equal(await whenShellReady(40), false)

  // A consumer registered before the signal resolves as soon as it arrives.
  const waiting = whenShellReady(2_000)
  markShellReady()
  assert.equal(await waiting, true)
  assert.equal(isShellReady(), true)

  // Late consumers are already satisfied and do not wait again.
  assert.equal(await whenShellReady(0), true)

  // Re-signalling is a no-op (the shell is published once per lifetime).
  markShellReady()
  assert.equal(await whenShellReady(0), true)
})
