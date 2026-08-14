import { describe, expect, it } from "vitest"

import { validateManagedExtensionManifest } from "./manifest"

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

describe("validateManagedExtensionManifest", () => {
  it("accepts a well-formed MCP Extension", () => {
    expect(validateManagedExtensionManifest(manifest())).toMatchObject({
      id: "io.amiba.personal.test",
      permissions: [],
      dataSchemaVersion: 1,
    })
  })

  it("rejects entries that escape the Extension source tree", () => {
    const input = manifest()
    input.mcp.providers[0]!.entry = "../../secrets.mjs"
    expect(() => validateManagedExtensionManifest(input)).toThrow("must stay inside")
  })

  it("requires mention sources to refer to a declared provider", () => {
    const input = { ...manifest(), mentions: [{
      id: "docs",
      provider: "missing",
      label: "Docs",
      resourceUriTemplate: "docs://search/{query}",
    }] }
    expect(() => validateManagedExtensionManifest(input)).toThrow("provider is not declared")
  })

  it("accepts unique Hermes Plugin dependencies", () => {
    const input = {
      ...manifest(),
      hermesPlugins: [{ id: "web_search", version: ">=1.2.0", required: true }],
    }
    expect(validateManagedExtensionManifest(input).hermesPlugins).toEqual(input.hermesPlugins)
  })

  it("rejects duplicate Hermes Plugin dependencies", () => {
    const input = {
      ...manifest(),
      hermesPlugins: [{ id: "web_search" }, { id: "web_search" }],
    }
    expect(() => validateManagedExtensionManifest(input)).toThrow("duplicate Hermes plugin id")
  })
})
