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
