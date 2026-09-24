// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import * as Cordis from "@deepseek-ai/cordis";
import * as Slots from "@deepseek-ai/dsh-client-ui-slots";
import * as Store from "@deepseek-ai/dsh-client-store";
import { afterEach, expect, it, vi } from "vitest";
import { mountOfficialWorkspaceServices } from "./official-workspace-services.js";
import { createShellChildren } from "./shell-children.js";
import { NATIVE_REPLACEMENT_PRIORITY, NativeOfficialPresentation, OFFICIAL_REPLACEMENTS } from "./official-replacements.js";

const require = createRequire(import.meta.url);
const modules: Record<string, unknown> = {
  react: React, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient,
  "react/jsx-runtime": JSXRuntime, "@deepseek-ai/cordis": Cordis,
  "@deepseek-ai/dsh-client-ui-slots": Slots, "@deepseek-ai/dsh-client-store": Store,
  // Presentation atoms are not needed for registration. Fail if an apply
  // starts depending on them rather than silently mocking startup behavior.
  "@deepseek-ai/dsh-client-ui-primitives": new Proxy({}, { get(_target, key) {
    throw new Error(`Unexpected presentation dependency during startup: ${String(key)}`);
  } }),
};
function published(name: string): { apply(ctx: Cordis.Context): void } {
  let result!: ReturnType<typeof published>;
  new Function("window", readFileSync(require.resolve(`${name}/client`), "utf8"))({
    __ModuleLoader__: { load: ({ factory }: { factory(require: (name: string) => unknown): typeof result }) => {
      result = factory(id => {
        if (!(id in modules)) throw new Error(`Unexpected published dependency: ${id}`);
        return modules[id];
      });
    } },
  });
  return result;
}
const renderer = published("@deepseek-ai/dsh-client-ui-renderer");
const workspace = published("@deepseek-ai/dsh-client-ui-workspace");

const picker = published("@deepseek-ai/dsh-client-ui-directory-picker-native");
const contexts: Cordis.Context[] = [];
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose(); });
const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} });
function fixture() {
  const ctx = new Cordis.Context();
  contexts.push(ctx);
  ctx.reflect.provide("sessions", { list: source({ phase: "ready", ids: [], byId: {} }) });
  ctx.reflect.provide("workspaces", { list: source({ phase: "ready", items: [], archivedSessionIds: [] }) });
  ctx.reflect.provide("locale", { register: () => () => {} });
  ctx.reflect.provide("remote", { directoryPicker: {}, $on: () => () => {} });
  ctx.reflect.provide("uiSession", { registerPendingInteraction: () => vi.fn() });
  renderer.apply(ctx);
  return ctx;
}
const ownedChildren = [
  ["sidebar.workspaces", "sidebar.workspaces.directoryFlow"],
  ["conversation.hero.workspace", "conversation.hero.workspace.directoryFlow"],
  ["conversation.composer", "conversation.approval.detail"],
] as const;

// Use published plugin applies and the real registry, not hand-written slot
// stubs: rc.2 declares children even when another entry wins the parent cell.
it.each(["shell-first", "plugins-first"])("boots the production slot composition (%s), including reload", order => {
  const ctx = fixture();
  const mountShell = () => {
    const dispose = ctx.slots.register({ name: "root", children: createShellChildren(() => {}) }, ({ renderSlot }: Slots.PropsRenderSlots<keyof ReturnType<typeof createShellChildren>>) => { void renderSlot; return null; });
    for (const name of Object.keys(OFFICIAL_REPLACEMENTS) as (keyof typeof OFFICIAL_REPLACEMENTS)[])
      ctx.slots.register({ name, priority: NATIVE_REPLACEMENT_PRIORITY }, NativeOfficialPresentation);
    return dispose;
  };
  const mountPlugins = () => { mountOfficialWorkspaceServices(ctx, workspace.apply); picker.apply(ctx); };
  let off!: () => void;
  expect(() => {
    if (order === "shell-first") { off = mountShell(); mountPlugins(); }
    else { mountPlugins(); off = mountShell(); }
  }).not.toThrow();
  const verify = () => {
    for (const [parent, child] of ownedChildren) {
      const owners = ctx.slots.entries(parent).filter(entry => child in (entry.children ?? {}));
      expect(owners).toHaveLength(0);
      expect(ctx.slots.entries("root")[0]?.children).toHaveProperty(child);
      expect(ctx.slots.spec(child)).toBeDefined();
    }
    for (const name of ["sidebar.workspaces.directoryFlow", "conversation.hero.workspace.directoryFlow"] as const)
      expect(ctx.slots.entriesOfSlot(name)).toHaveLength(1);
  };
  expect(ctx.get("uiWorkspace")).toBeDefined();
  verify();
  off();
  for (const [, child] of ownedChildren) expect(ctx.slots.spec(child)).toBeUndefined();
  off = mountShell();
  verify();
  off();
});

// Pin the composition policy: defaults must not reclaim shell-owned children.
it("disables only conflicting default UI while retaining picker plugins", () => {
  const patch = readFileSync(require.resolve("../../../../bundles/dsh-bundle-amiba-web/cordis.patch.yml"), "utf8");
  for (const id of ["ui-workspace", "ui-approval", "ui-brand-official"])
    expect(patch).toMatch(new RegExp(`- id: ${id}\\n  disabled: true`));
  expect(patch).not.toMatch(/- id: ui-directory-picker/);
});

it("keeps third-party registrations outside the workspace facade", () => {
  const ctx = fixture();
  ctx.slots.register({ name: "root", children: createShellChildren(() => {}) }, ({ renderSlot }: Slots.PropsRenderSlots<keyof ReturnType<typeof createShellChildren>>) => { void renderSlot; return null; });
  mountOfficialWorkspaceServices(ctx, workspace.apply);
  const off = ctx.slots.register({ name: "sidebar.workspaces.directoryFlow" }, () => null);
  expect(ctx.slots.entriesOfSlot("sidebar.workspaces.directoryFlow")).toHaveLength(1);
  off();
  expect(ctx.slots.entriesOfSlot("sidebar.workspaces.directoryFlow")).toHaveLength(0);
});
