import assert from "node:assert/strict"
import test from "node:test"

import { createDshNativeOperationRouter } from "../dsh-native-gateway.ts"

test("DSH native gateway executes only registered operations", async () => {
  const router = createDshNativeOperationRouter([
    {
      name: "native_test",
      call: (args) => ({ value: args.value }),
    },
  ])
  assert.deepEqual(await router.call("native_test", { value: 42 }), { value: 42 })
  await assert.rejects(
    router.call("not_registered", {}),
    /Unknown native operation/u,
  )
})

test("DSH native gateway rejects duplicate operation names", () => {
  assert.throws(
    () => createDshNativeOperationRouter([
      { name: "duplicate", call: () => undefined },
      { name: "duplicate", call: () => undefined },
    ]),
    /Duplicate or empty/u,
  )
})

test("DSH native gateway lifts the reserved session key out of the arguments", async () => {
  const seen = []
  const router = createDshNativeOperationRouter([
    {
      name: "native_test",
      call: (args, context) => {
        seen.push({ args, context })
        return { ok: true }
      },
    },
  ])

  // The gateway wire has no context channel, so the calling session arrives
  // as a reserved argument key. It is a transport detail: the operation must
  // receive it as context and never see it among its own arguments.
  await router.call("native_test", { url: "https://example.com", amibaSessionId: "session-background" })
  assert.deepEqual(seen.at(-1), {
    args: { url: "https://example.com" },
    context: { sessionId: "session-background" },
  })

  await router.call("native_test", { url: "https://example.com" })
  assert.deepEqual(seen.at(-1), {
    args: { url: "https://example.com" },
    context: { sessionId: undefined },
  })

  // A non-string value is not an identity; it is dropped, not forwarded.
  await router.call("native_test", { amibaSessionId: 7 })
  assert.deepEqual(seen.at(-1), { args: {}, context: { sessionId: undefined } })
})
