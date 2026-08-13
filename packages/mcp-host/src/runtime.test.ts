import { describe, expect, it } from "vitest"

import type { ManagedAppManifest, ManagedAppProviderManifest } from "@amiba/managed-apps/types"
import { createManagedMcpRuntime } from "./runtime"

function manifest(provider: ManagedAppProviderManifest): ManagedAppManifest {
  return {
    schemaVersion: 1,
    id: "io.amiba.personal.runtime-test",
    name: "Runtime test",
    kind: "tool-app",
    runtime: "node",
    mcp: { providers: [provider] },
    permissions: [],
  }
}

describe("managed MCP runtime boundaries", () => {
  it("never executes a bundled provider entry outside its bundle", async () => {
    const runtime = createManagedMcpRuntime()
    await expect(runtime.discover({
      appId: "io.amiba.personal.runtime-test",
      projectPath: "/tmp/amiba-runtime-test",
      manifest: manifest({ alias: "main", kind: "bundled", runtime: "node", entry: "../outside.mjs" }),
    })).rejects.toThrow("escapes the Applet bundle")
    await runtime.close()
  })

  it("fails closed when a registered provider cannot be resolved", async () => {
    const runtime = createManagedMcpRuntime()
    await expect(runtime.discover({
      appId: "io.amiba.personal.runtime-test",
      projectPath: "/tmp/amiba-runtime-test",
      manifest: manifest({ alias: "main", kind: "registered", providerId: "private-provider" }),
    })).rejects.toThrow("registered MCP provider is unavailable")
    await runtime.close()
  })
})
