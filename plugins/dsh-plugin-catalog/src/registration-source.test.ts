import { Context } from "@deepseek-ai/cordis";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { expect, it } from "vitest";
import { registrationSource } from "./registration-source.js";

const entryKey = Symbol.for("cordis.entry");
const shipped = new Map([["official-entry", "@vendor/plugin"], ["amiba-entry", "@amiba/plugin"]]);
function owner(id: string, module: string, parent: object = {}) {
  return { fiber: { uid: 1, name: module, parent }, [entryKey]: { id, options: { id, name: module }, parent: { ctx: {} } } } as unknown as Context;
}
it("uses shipped entry identity, not the vendor or a claimed builtin flag", () => {
  expect(registrationSource(owner("official-entry", "@vendor/plugin"), shipped).distribution).toBe("builtin");
  expect(registrationSource(owner("amiba-entry", "@amiba/plugin"), shipped).distribution).toBe("builtin");
  expect(registrationSource(owner("user-entry", "@vendor/plugin"), shipped).distribution).toBe("user");
  expect(registrationSource(owner("amiba-entry", "@user/replacement"), shipped).distribution).toBe("user");
});
it("honors user presets and the dynamic code authoring boundary", () => {
  const ctx = owner("official-entry", "@vendor/plugin");
  expect(registrationSource(ctx, shipped, { id: "custom", trust: "user" }).distribution).toBe("user");
  const dynamic = owner("official-entry", "@vendor/plugin", { fiber: { runtime: { name: "cordis-dynamic" } } });
  expect(registrationSource(dynamic, shipped).distribution).toBe("user");
});
it("the patched registry retains each exact registration context without changing wire schemas", () => {
  const contexts = new Map<object, Context>();
  const global = new Map<string, object>();
  const local = new Map<string, object>();
  const ctx = owner("official-entry", "@vendor/plugin");
  const definition = { name: "search", parameters: {}, output: { schema: { type: "object" }, render: () => [] } };
  const registry = {
    ctx, registrationContexts: contexts,
    layers: { effect: (owner: Context, insert: (layer: object) => void) => {
      const table = owner === ctx ? global : local;
      insert({ tools: { insert: (name: string, value: object) => { table.set(name, value); return () => table.delete(name); } } });
    } },
    get: (name: string, scope?: object) => (scope ? local : global).get(name),
  };
  ToolRuntime.prototype.register.call(registry as never, definition as never);
  const child = owner("user-entry", "@vendor/plugin");
  ToolRuntime.prototype.register.call({ ...registry, ctx: child } as never, definition as never);
  expect(global.get("search")).not.toBe(local.get("search"));
  expect(ToolRuntime.prototype.registrationContext.call(registry as never, "search")).toBe(ctx);
  expect(ToolRuntime.prototype.registrationContext.call(registry as never, "search", {})).toBe(child);
  expect(definition).not.toHaveProperty("registrationContext");
});

it("does not attribute a user-added child to a shipped group or the boot include", () => {
  const include = { options: { id: "include", name: "cordis:include" }, parent: { ctx: {} } };
  const group = { options: { id: "shipped-group", name: "cordis:group" }, parent: { ctx: {} } };
  const ctx = owner("user-child", "@vendor/plugin");
  const entry = (ctx as unknown as Record<symbol, any>)[entryKey];
  entry.parent = { ctx: { [entryKey]: group }, tree: { ctx: { [entryKey]: include } } };
  expect(registrationSource(ctx, new Map([...shipped, ["shipped-group", "cordis:group"]])).distribution).toBe("user");
  entry.options = { id: "official-entry", name: "@vendor/plugin" };
  expect(registrationSource(ctx, shipped).distribution).toBe("builtin");
});
