import { describe, expect, it, vi } from "vitest"
import type { ExtensionManifest, MainHost } from "@hermes-x/extension-api"
import { activateMainExtensions } from "../main/activate"

const fakeHost = (id: string): MainHost => ({
  id,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  ipc: { expose: vi.fn(() => ({ dispose: vi.fn() })) },
  lifecycle: {
    onBootBackground: vi.fn(() => ({ dispose: vi.fn() })),
    onShutdown: vi.fn(() => ({ dispose: vi.fn() })),
  },
  settings: { get: vi.fn(), set: vi.fn() } as unknown as MainHost["settings"],
  storage: { get: vi.fn(), set: vi.fn() } as unknown as MainHost["storage"],
  hermes: { callTool: vi.fn() } as unknown as MainHost["hermes"],
})

const mk = (id: string): ExtensionManifest => ({
  id,
  name: id,
  version: "0.1.0",
  entries: { main: "dist/main.cjs" },
})

describe("activateMainExtensions", () => {
  it("activates each extension exactly once", async () => {
    const ok = vi.fn().mockResolvedValue(undefined)
    const result = await activateMainExtensions({
      manifests: [mk("io.a.one"), mk("io.b.two")],
      loadMain: async () => ({ activate: ok }),
      makeHost: fakeHost,
    })
    expect(ok).toHaveBeenCalledTimes(2)
    expect(result.loaded.map((e) => e.id)).toEqual(["io.a.one", "io.b.two"])
    expect(result.failed).toHaveLength(0)
  })

  it("isolates a failing extension and continues loading others", async () => {
    const result = await activateMainExtensions({
      manifests: [mk("io.a.bad"), mk("io.b.good")],
      loadMain: async (id) => ({
        activate:
          id === "io.a.bad"
            ? () => {
                throw new Error("boom")
              }
            : vi.fn().mockResolvedValue(undefined),
      }),
      makeHost: fakeHost,
    })
    expect(result.failed.map((e) => e.id)).toEqual(["io.a.bad"])
    expect(result.failed[0].error).toMatch(/boom/)
    expect(result.loaded.map((e) => e.id)).toEqual(["io.b.good"])
  })

  it("times out an activate that hangs > timeoutMs", async () => {
    const result = await activateMainExtensions({
      manifests: [mk("io.slow.one")],
      loadMain: async () => ({
        activate: () => new Promise(() => undefined),
      }),
      makeHost: fakeHost,
      timeoutMs: 50,
    })
    expect(result.failed.map((e) => e.id)).toEqual(["io.slow.one"])
    expect(result.failed[0].error).toMatch(/timeout/i)
  })
})
