/**
 * Regression guard for the DSH state sources' RPC result contract.
 *
 * `DshApiClient.call` unwraps the RPC envelope itself: it rejects when the
 * remote call fails and otherwise resolves to the remote's own result value
 * (`packages/app-runtime/src/dsh-client/index.ts`). These sources used to
 * re-check a `{ ok, value }` wrapper that never exists, so every poll bailed
 * out early: the pet library stayed `null`, `buildSnapshot()` always returned
 * `null`, and no `dsh-state:snapshot` was ever broadcast — which left the
 * desktop pet window created but never shown.
 *
 * The stubs below therefore resolve with the *value*, exactly like the real
 * client, so a reintroduced double-unwrap fails these tests.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { NotificationSource, PetsSource } from "../dsh-state/sources.ts"

const library = {
  version: 1,
  activeId: "pet-1",
  pets: [{ id: "pet-1", name: "Mofli", config: { version: 1 }, updatedAt: 1 }],
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return true
    if (Date.now() > deadline) return predicate()
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test("PetsSource stores the library the remote call resolves to", async () => {
  const calls = []
  const source = new PetsSource(async () => ({
    call: async (method, payload) => {
      calls.push({ method, payload })
      return library
    },
  }))
  try {
    source.start()
    assert.equal(await waitFor(() => source.getSnapshot() !== null), true)
    assert.deepEqual(source.getSnapshot(), library)
    assert.deepEqual(calls[0], {
      method: "amibaPets/list",
      payload: { args: {} },
    })
  } finally {
    source.dispose()
  }
})

test("PetsSource.activate adopts the refreshed library", async () => {
  const refreshed = {
    ...library,
    activeId: "pet-2",
    pets: [...library.pets, { id: "pet-2", name: "Mallow", config: {}, updatedAt: 2 }],
  }
  const source = new PetsSource(async () => ({
    call: async () => refreshed,
  }))
  try {
    await source.activate("pet-2")
    assert.deepEqual(source.getSnapshot(), refreshed)
  } finally {
    source.dispose()
  }
})

test("PetsSource keeps the last snapshot when a poll rejects", async () => {
  let failing = false
  const source = new PetsSource(async () => ({
    call: async () => {
      if (failing) throw new Error("transport down")
      return library
    },
  }))
  try {
    source.start()
    assert.equal(await waitFor(() => source.getSnapshot() !== null), true)
    failing = true
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.deepEqual(source.getSnapshot(), library)
  } finally {
    source.dispose()
  }
})

test("NotificationSource connects and applies the watch update", async () => {
  const update = {
    cursor: { epoch: "e1", revision: 1 },
    reset: true,
    notifications: [
      { id: "n2", timestamp: 20 },
      { id: "n1", timestamp: 10 },
    ],
    removed: [],
  }
  const calls = []
  let watches = 0
  const source = new NotificationSource(async () => ({
    call: async (method, payload) => {
      calls.push({ method, payload })
      if (method !== "amibaNotifications/watch") return true
      watches += 1
      // Park the long-poll after the first answer so the follower loop does
      // not spin while the assertions run.
      return watches === 1 ? update : new Promise(() => {})
    },
  }))
  try {
    source.start()
    assert.equal(
      await waitFor(() => source.getSnapshot().connection === "connected"),
      true,
    )
    assert.deepEqual(
      source.getSnapshot().rows.map((row) => row.id),
      ["n1", "n2"],
    )
    await source.dismiss("n1")
    await source.markSessionsRead([{ sessionId: "s1", readAt: 10 }])
    assert.ok(
      calls.some((entry) => entry.method === "amibaNotifications/dismiss"),
    )
    assert.ok(
      calls.some(
        (entry) => entry.method === "amibaNotifications/markSessionsRead",
      ),
    )
  } finally {
    source.dispose()
  }
})

test("NotificationSource treats a malformed watch payload as a dropped subscription", async () => {
  const source = new NotificationSource(async () => ({
    call: async () => ({ cursor: { epoch: "e1", revision: 1 } }),
  }))
  try {
    source.start()
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(source.getSnapshot().connection, "reconnecting")
    assert.deepEqual(source.getSnapshot().rows, [])
  } finally {
    source.dispose()
  }
})
