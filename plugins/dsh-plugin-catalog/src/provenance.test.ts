import { describe, expect, it } from "vitest";

import { ToolProvenanceRegistry } from "./provenance.js";

describe("Amiba DSH tool provenance", () => {
  it("distinguishes stock, product and configured MCP tools", () => {
    const registry = new ToolProvenanceRegistry();
    registry.register("memos_search", {
      kind: "dsh-plugin",
      id: "amiba-memory",
      name: "Amiba Memory",
      packageName: "@amiba/dsh-plugin-memory",
      loadMode: "plugin",
      executionTarget: "dsh-runtime",
      dynamic: false,
    });
    registry.registerMcpServer("linear_team");

    expect(registry.resolve("memos_search").kind).toBe("dsh-plugin");
    expect(registry.resolve("mcp__linear_team__list_issues")).toMatchObject({
      kind: "mcp-server",
      id: "dsh-mcp-client",
      loadMode: "mcp",
      provider: "linear_team",
    });
    expect(() => registry.resolve("bash")).toThrow("Missing registration context");
  });

  it("removes dynamic ownership without affecting the unidentified fallback", () => {
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
    expect(() => registry.resolve("amiba_browser_open")).toThrow();
  });
});

it("keeps connection labels separate from the server identity and releases them", () => {
  const registry = new ToolProvenanceRegistry();
  const dispose = registry.registerMcpServer("lark-one", "Work account");
  registry.registerMcpServer("lark-two", "Work account");
  expect(registry.resolve("mcp__lark-one__search")).toMatchObject({
    provider: "lark-one",
    displayName: "Work account",
  });
  expect(registry.resolve("mcp__lark-two__search")).toMatchObject({
    provider: "lark-two",
    displayName: "Work account",
  });
  dispose();
  expect(() => registry.resolve("mcp__lark-one__search")).toThrow();
  expect(registry.resolve("mcp__lark-two__search").displayName).toBe(
    "Work account",
  );
});

it("does not equate vendor or dynamic loading with delivery", () => {
  const registry = new ToolProvenanceRegistry();
  const source = { kind: "dsh-plugin", id: "builtin", name: "Product", loadMode: "plugin", executionTarget: "dsh-runtime", dynamic: true, distribution: "builtin" } as const;
  registry.register("builtin_dynamic", source);
  registry.register("official_user", { ...source, kind: "dsh-core", distribution: "user" });
  registry.registerMcpServer("manual");
  registry.registerMcpServer("shipped", undefined, { distribution: "builtin" });
  expect(registry.resolve("builtin_dynamic").distribution).toBe("builtin");
  expect(registry.resolve("official_user").distribution).toBe("user");
  expect(registry.resolve("mcp__manual__search").distribution).toBe("user");
  expect(registry.resolve("mcp__shipped__search").distribution).toBe("builtin");
  expect(() => registry.resolve("unclaimed")).toThrow();
});
