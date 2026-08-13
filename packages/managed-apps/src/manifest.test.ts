import { describe, expect, it } from "vitest"

import { validateManagedAppManifest } from "./manifest"

function manifest() {
  return {
    schemaVersion: 1,
    id: "io.amiba.personal.test",
    name: "Test",
    kind: "interactive-ui",
    runtime: "node",
    mcp: {
      providers: [{ alias: "main", kind: "bundled", runtime: "node", entry: "server.mjs" }],
    },
    surfaces: { main: { provider: "main", resourceUri: "ui://test/main" } },
  }
}

describe("validateManagedAppManifest", () => {
  it("accepts a well-formed MCP Applet", () => {
    expect(validateManagedAppManifest(manifest())).toMatchObject({
      id: "io.amiba.personal.test",
      permissions: [],
      dataSchemaVersion: 1,
    })
  })

  it("rejects entries that escape the Applet source tree", () => {
    const input = manifest()
    input.mcp.providers[0]!.entry = "../../secrets.mjs"
    expect(() => validateManagedAppManifest(input)).toThrow("must stay inside")
  })

  it("requires mention sources to refer to a declared provider", () => {
    const input = { ...manifest(), mentions: [{
      id: "docs",
      provider: "missing",
      label: "Docs",
      resourceUriTemplate: "docs://search/{query}",
    }] }
    expect(() => validateManagedAppManifest(input)).toThrow("provider is not declared")
  })
})

