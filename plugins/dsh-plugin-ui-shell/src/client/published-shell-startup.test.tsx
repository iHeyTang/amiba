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
import { mountOfficialFeature, OFFICIAL_FEATURE_REGISTRANT } from "./official-features/mount.js";
import { officialChatRequested } from "./official-chat-presentation.js";
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

const featurePlugins = Object.fromEntries([['plan', 'plan'], ['feedback', 'message-feedback'], ['goal', 'goal'], ['subagent', 'subagent'], ['jobs', 'jobs'], ['workflow', 'workflow-run']].map(([key, name]) => [key, published(`@deepseek-ai/dsh-client-ui-${name}`)]));
it("mounts all six published feature applies without replacing Amiba's transcript or extension seats", async () => {
  const ctx = fixture();
  const goal = Store.createSnapshotStore({ goal: { id: 'g1', revision: 1 } });
  const pause = vi.fn(async () => ({ ok: true, value: undefined }));
  const openSubagent = vi.fn();
  const setCatalogOpen = vi.fn();
  const execute = vi.fn(async () => ({ ok: true, value: {} }));
  const list = vi.fn(async () => ({ ok: true, value: { ok: true, value: { items: [] } } }));
  const put = vi.fn(async () => ({ ok: true, value: { ok: true, value: { messageId: 'm1', rating: 'positive', version: 1 } } }));
  Object.assign(ctx.sessions, { binding: () => ({ session: { ...source({ phase: 'ready' }), projections: { faceOf: () => goal } } }), openSubagent, setSubagentCatalogOpen: setCatalogOpen });
  Object.assign(ctx.remote, { goals: { pause }, commands: { execute }, messageFeedback: { list, put }, sessionFeedback: {} });
  ctx.reflect.provide('uiConversation', { events: { register: vi.fn() } });
  ctx.slots.register({ name: 'root', children: createShellChildren(() => {}) }, ({ renderSlot }: Slots.PropsRenderSlots<keyof ReturnType<typeof createShellChildren>>) => { void renderSlot; return null; });
  ctx.slots.register({ name: 'conversation.view', id: 'test-chat', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session', inject: { commandFor: () => undefined, stepsFor: () => [], toolsForStep: () => [] } as never } } }, ({ renderSlot }: Slots.PropsRenderSlots<'conversation.chat.node'>) => { void renderSlot; return null; });
  const fibers = Object.entries(featurePlugins).map(([name, plugin]) => ctx.plugin(scope => mountOfficialFeature(scope, name as Parameters<typeof mountOfficialFeature>[1], plugin.apply)));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(officialChatRequested(ctx.slots).getSnapshot()).toBe(false);
  for (const name of ['conversation.input.plan', 'conversation.input.dock', 'conversation.input.overlay', 'conversation.chat.assistant-actions', 'conversation.session.header.lineage', 'conversation.composer', 'conversation.session.header.actions', 'amiba.conversation.workflow'] as const) {
    expect(ctx.slots.entriesOfSlot(name).some(entry => entry.registrant === OFFICIAL_FEATURE_REGISTRANT)).toBe(true);
  }
  const dock = ctx.slots.entriesOfSlot('conversation.input.dock')[0]!;
  const verbs = dock.inject!('session-a' as never) as unknown as { onPause(): Promise<unknown> };
  await verbs.onPause();
  expect(pause).toHaveBeenLastCalledWith('session-a', { id: 'g1', revision: 1 });
  goal.set({ goal: { id: 'g1', revision: 2 } });
  await verbs.onPause();
  expect(pause).toHaveBeenLastCalledWith('session-a', { id: 'g1', revision: 2 });
  const plan = ctx.slots.entriesOfSlot('conversation.input.plan')[0]!;
  await (plan.inject!('session-a' as never) as unknown as { exitPlanMode(): Promise<unknown> }).exitPlanMode();
  expect(execute).toHaveBeenCalledWith('session-a', '/plan off', []);
  const readonly = ctx.slots.entriesOfSlot('conversation.composer')[0]!;
  expect(readonly.select!({ session: { subagent: { address: { mode: 'one-shot' } } } } as never)).toEqual({ reason: 'one-shot' });
  expect(readonly.select!({ session: { subagent: { address: { mode: 'continuable' }, parentAvailable: true } } } as never)).toBeNull();
  const feedback = ctx.slots.entriesOfSlot('conversation.chat.assistant-actions')[0]!.inject!('session-a' as never) as unknown as import('@deepseek-ai/dsh-client-ui-message-feedback/client').MessageFeedbackInjected;
  const dialog = ctx.slots.entriesOfSlot('conversation.input.overlay')[0]!.inject!('session-a' as never) as unknown as import('@deepseek-ai/dsh-client-ui-message-feedback/client').FeedbackDialogInjected;
  feedback.openDialog('m1' as never, 'positive');
  dialog.edit({ text: '  Useful result  ', category: 'task-result' });
  await dialog.submit();
  expect(put).toHaveBeenCalledWith({ sessionId: 'session-a', messageId: 'm1', rating: 'positive', ifVersion: null, note: 'Useful result', category: 'task-result' });
  expect(dialog.hooks.dialog.getSnapshot().target).toBeNull();
  expect(dialog.hooks.dialog.getSnapshot().toast).toBeGreaterThan(0);
  const offExternal = ctx.slots.register({ name: 'conversation.chat.node', key: 'unknown', registrant: 'third-party' }, () => null);
  expect(officialChatRequested(ctx.slots).getSnapshot()).toBe(true);
  offExternal();
  await Promise.all(fibers.map(fiber => fiber.dispose()));
  expect(ctx.slots.entriesOfSlot('conversation.input.dock')).toHaveLength(0);
  expect(ctx.slots.entriesOfSlot('conversation.composer')).toHaveLength(0);
});
