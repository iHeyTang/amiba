import { describe, expect, it } from "vitest";

import { ToolProvenanceRegistry } from "./provenance.js";

describe("Amiba DSH tool provenance", () => {
  it("distinguishes stock, product and configured MCP tools", () => {
    const registry = new ToolProvenanceRegistry();
    registry.register("memory_list", {
      kind: "dsh-plugin",
      id: "amiba-memory",
      name: "Amiba Memory",
      packageName: "@amiba/dsh-plugin-memory",
      loadMode: "plugin",
      executionTarget: "dsh-runtime",
      dynamic: false,
    });
    registry.registerMcpServer("linear_team");

    expect(registry.resolve("memory_list").kind).toBe("dsh-plugin");
    expect(registry.resolve("mcp__linear_team__list_issues")).toMatchObject({
      kind: "mcp-server",
      id: "dsh-mcp-client",
      loadMode: "mcp",
      provider: "linear_team",
    });
    expect(registry.resolve("bash")).toMatchObject({
      kind: "dsh-core",
      id: "managed-dsh-profile:web",
    });
  });

  it("removes dynamic ownership without affecting the stock fallback", () => {
    const registry = new ToolProvenanceRegistry();
    const dispose = registry.register("amiba_browser_open", {
      kind: "dsh-plugin",
      id: "amiba-browser-core",
      name: "Amiba Browser",
      packageName: "@amiba/dsh-plugin-browser-core",
      loadMode: "plugin",
      executionTarget: "external-process",
      dynamic: true,
    });
    expect(registry.resolve("amiba_browser_open").kind).toBe("dsh-plugin");
    dispose();
    expect(registry.resolve("amiba_browser_open").kind).toBe("dsh-core");
  });
});
