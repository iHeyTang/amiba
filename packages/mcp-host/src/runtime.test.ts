import { describe, expect, it } from "vitest"

import type { ManagedExtensionManifest, ManagedExtensionProviderManifest } from "@amiba/managed-extensions/types"
import { createManagedMcpRuntime } from "./runtime"

function manifest(provider: ManagedExtensionProviderManifest): ManagedExtensionManifest {
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
      extensionId: "io.amiba.personal.runtime-test",
      projectPath: "/tmp/amiba-runtime-test",
      manifest: manifest({ alias: "main", kind: "bundled", runtime: "node", entry: "../outside.mjs" }),
    })).rejects.toThrow("escapes the Extension bundle")
    await runtime.close()
  })

  it("fails closed when a registered provider cannot be resolved", async () => {
    const runtime = createManagedMcpRuntime()
    await expect(runtime.discover({
      extensionId: "io.amiba.personal.runtime-test",
      projectPath: "/tmp/amiba-runtime-test",
      manifest: manifest({ alias: "main", kind: "registered", providerId: "private-provider" }),
    })).rejects.toThrow("registered MCP provider is unavailable")
    await runtime.close()
  })
})
