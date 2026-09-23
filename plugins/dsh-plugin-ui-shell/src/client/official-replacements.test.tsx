// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import * as Slots from "@deepseek-ai/dsh-client-ui-slots";
import * as Cordis from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OFFICIAL_REPLACEMENTS, OfficialReplacement, NativeOfficialPresentation, NATIVE_REPLACEMENT_PRIORITY } from "./official-replacements.js";

afterEach(cleanup);
const require = createRequire(import.meta.url);
const modules: Record<string, unknown> = { "@deepseek-ai/cordis": Cordis, react: React, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient, "react/jsx-runtime": JSXRuntime, "@deepseek-ai/dsh-client-ui-slots": Slots };
let renderer: Slots.SlotRenderer;
new Function("window", readFileSync(require.resolve("@deepseek-ai/dsh-client-ui-renderer/client"), "utf8"))({
  __ModuleLoader__: { load: ({ factory }: { factory: (resolve: (id: string) => unknown) => {
    SlotRegistry: { prototype: { install: (value: Slots.SlotRenderer) => void } };
    apply: (ctx: Context) => void;
  } }) => {
    const module = factory(id => { if (!(id in modules)) throw new Error(`Unexpected renderer dependency: ${id}`); return modules[id]; });
    // Capture the real React renderer installed by the published client bundle.
    module.SlotRegistry.prototype.install = value => { renderer = value; };
    module.apply(new Cordis.Context());
  } },
});
const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} });

it.each(Object.keys(OFFICIAL_REPLACEMENTS) as (keyof typeof OFFICIAL_REPLACEMENTS)[])("%s supports native fallback, plugin takeover, empty output, crash and unload with rc.2 renderer", async name => {
  const core = new Slots.SlotCore();
  const ctx = {} as Context;
  const binding: Slots.ScopedStandardSourceBinding = { key: "session-a", ctx, hooks: {}, keyedHooks: {}, props: { sessionId: "session-a" } };
  const report = vi.fn(core.reportEntryError.bind(core));
  const host: Slots.SlotRendererHost = {
    subscribe: core.subscribe.bind(core), getVersion: core.getVersion.bind(core), entriesOf: core.entries.bind(core), entriesOfSlot: core.entriesOfSlot.bind(core),
    specOf: core.specDynamic.bind(core), isLive: core.isLive.bind(core), storeOf: () => undefined, reportEntryError: report,
    root: source({ key: undefined, hooks: {}, keyedHooks: {}, props: {} }), scopeRevision: source(0),
    // rc.2 published JS requests this method although its .d.ts omits it.
    scope: () => ({ current: source(binding), resolve: () => binding,
      renderArea: (_binding: unknown, props: { children?: React.ReactNode }) => props.children,
    }),
  };
  const owner = { size: 24, wide: true, width: 240, collapsed: false };
  core.register({ name: "root", children: OFFICIAL_REPLACEMENTS }, ({ renderSlot }: Slots.PropsRenderSlots<keyof typeof OFFICIAL_REPLACEMENTS>) => {
    const fallback = <span>native</span>;
    return <OfficialReplacement fallback={fallback}>{renderSlot(name, owner as never, { fallback })}</OfficialReplacement>;
  });
  core.register({ name, priority: NATIVE_REPLACEMENT_PRIORITY }, NativeOfficialPresentation);
  const view = render(renderer.renderRoot(host, {}));
  expect(screen.getByText("native")).toBeTruthy();
  let off!: () => void;
  const plugin = vi.fn((_props: object) => <span>plugin</span>);
  await act(async () => { off = core.register({ name }, plugin); });
  expect(screen.getByText("plugin")).toBeTruthy();
  expect(plugin.mock.calls[0]?.[0]).toEqual(expect.objectContaining(owner));
  expect(screen.queryByText("native")).toBeNull();
  await act(async () => off());
  expect(screen.getByText("native")).toBeTruthy();
  await act(async () => { off = core.register({ name }, () => null); });
  expect(view.container.textContent).toBe("");
  await act(async () => off());
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => { off = core.register({ name }, () => { throw new Error("plugin crash"); }); });
    expect(report).toHaveBeenCalled();
    expect(screen.getByText("native")).toBeTruthy();
    await act(async () => off());
  } finally { quiet.mockRestore(); }
});

it("composer chain elects by pending interaction and preserves the native draft DOM across takeover", async () => {
  const core = new Slots.SlotCore();
  const binding: Slots.ScopedStandardSourceBinding = { key: "session-a", ctx: {} as Context, hooks: {}, keyedHooks: {}, props: { sessionId: "session-a" } };
  const host: Slots.SlotRendererHost = {
    subscribe: core.subscribe.bind(core), getVersion: core.getVersion.bind(core), entriesOf: core.entries.bind(core), entriesOfSlot: core.entriesOfSlot.bind(core),
    specOf: core.specDynamic.bind(core), isLive: core.isLive.bind(core), storeOf: () => undefined, reportEntryError: core.reportEntryError.bind(core),
    root: source({ key: undefined, hooks: {}, keyedHooks: {}, props: {} }), scopeRevision: source(0),
    // rc.2 published JS requests this method although its .d.ts omits it.
    scope: () => ({ current: source(binding), resolve: () => binding,
      renderArea: (_binding: unknown, props: { children?: React.ReactNode }) => props.children,
    }),
  };
  let update!: React.Dispatch<React.SetStateAction<boolean>>;
  core.register({ name: "root", children: { "conversation.composer": { kind: "chain", scope: "session" } } }, ({ renderSlotChain }: Slots.PropsRenderSlots<"conversation.composer">) => {
    const [pending, setPending] = React.useState(false);
    update = setPending;
    return renderSlotChain("conversation.composer", {
      sessionId: "session-a" as never, session: undefined,
      pendingInteraction: pending ? { key: "ask-a", kind: "fixture", sessionId: "session-a" } as never : undefined,
    }, { fallback: <input aria-label="draft" defaultValue="retained" />, overlay: true });
  });
  let unload!: () => void;
  const view = render(renderer.renderRoot(host, {}));
  const draft = screen.getByLabelText("draft") as HTMLInputElement;
  draft.value = "unsent edits";
  await act(async () => {
    unload = core.register({ name: "conversation.composer", select: owner => owner.pendingInteraction ?? null }, ({ matched }) => <div>takeover:{matched.key}</div>);
  });
  expect(view.queryByText("takeover:ask-a")).toBeNull();
  await act(async () => update(true));
  expect(screen.getByText("takeover:ask-a")).toBeTruthy();
  expect(screen.getByLabelText("draft")).toBe(draft);
  expect(getComputedStyle(draft.parentElement!).display).toBe("none");
  await act(async () => update(false));
  expect(view.queryByText("takeover:ask-a")).toBeNull();
  expect(screen.getByLabelText("draft")).toBe(draft);
  expect(draft.value).toBe("unsent edits");
  await act(async () => update(true));
  await act(async () => unload());
  expect(view.queryByText("takeover:ask-a")).toBeNull();
  expect(screen.getByLabelText("draft")).toBe(draft);
  expect(draft.value).toBe("unsent edits");
});

it("official Chat bridge preserves keyed node owners, borrows existing slots, and restores on plugin unload", async () => {
  const { mountOfficialChatPresentation, officialChatRequested, RootSlotDispatch, OFFICIAL_CHAT_VIEW } = await import('./official-chat-presentation.js');
  const core = new Slots.SlotCore();
  const binding: Slots.ScopedStandardSourceBinding = { key: 'a', ctx: {} as Context, hooks: {}, keyedHooks: {}, props: { sessionId: 'a' } };
  const host: Slots.SlotRendererHost = {
    subscribe: core.subscribe.bind(core), getVersion: core.getVersion.bind(core), entriesOf: core.entries.bind(core), entriesOfSlot: core.entriesOfSlot.bind(core), specOf: core.specDynamic.bind(core),
    isLive: core.isLive.bind(core), storeOf: () => undefined, reportEntryError: core.reportEntryError.bind(core),
    root: source({ key: undefined, hooks: {}, keyedHooks: {}, props: {} }), scopeRevision: source(0),
    scope: () => ({ current: source(binding), resolve: () => binding, renderArea: (_binding: unknown, props: { children?: React.ReactNode }) => props.children }),
  };
  const node = { key: 'user:1', kind: 'user', anchorSeq: 1, visibility: 'visible', data: { text: 'real projected node' } };
  core.register({ name: 'root', children: {
    'conversation.view': { kind: 'list', scope: 'session' },
    'conversation.message.images': { kind: 'single', scope: 'session' },
  } }, ({ renderSlot }: Slots.PropsRenderSlots<'conversation.view' | 'conversation.message.images'>) => <RootSlotDispatch.Provider value={{ renderSlot: renderSlot as never, renderSlotChain: (() => null) as never }}>{renderSlot('conversation.view', { viewRequest: null, openView() {}, completeViewRequest() {} }, { only: OFFICIAL_CHAT_VIEW })}</RootSlotDispatch.Provider>);
  core.register({ name: 'conversation.message.images' }, () => <span>borrowed images</span>);
  const duplicate = vi.fn();
  const slots = { register: core.register.bind(core), entriesOfSlot: core.entriesOfSlot.bind(core), subscribe: core.subscribe.bind(core) };
  const ctx = { slots, uiConversation: { events: { register: duplicate }, views: { register: duplicate } }, uiSession: { provide: duplicate } } as unknown as Context;
  const upstreamRead = vi.fn(() => null);
  const receivedPosition = vi.fn();
  mountOfficialChatPresentation(ctx, scope => {
    scope.uiSession.provide({ hooks: [], resolve: () => ({ hooks: {} }) });
    scope.uiConversation.events.register({} as never);
    scope.slots.register({ name: 'conversation.view', id: 'chat', inject: () => ({ chatScroll: { read: upstreamRead, save() {} } }), children: {
      'conversation.chat.node': { kind: 'keyed', scope: 'session', inject: { hooks: { turnData: () => () => undefined } } },
      'conversation.message.images': { kind: 'single', scope: 'session' },
    } }, ((props: any) => { receivedPosition(props.chatScroll.read()); return <>{props.renderSlot('conversation.chat.node', { node, openFile() {}, inspectCall() {}, forkAt() {} }, { entryKey: 'user', hookContext: undefined })}{props.renderSlot('conversation.message.images', {})}</>; }) as never);
    scope.slots.register({ name: 'conversation.chat.node', key: 'user' }, ((props: any) => <span>native:{props.node.key}</span>) as never);
  });
  expect(duplicate).not.toHaveBeenCalled();
  const requested = officialChatRequested(slots as never);
  expect(requested.getSnapshot()).toBe(false);
  const { TranscriptScrollPositionContext } = await import('@amiba/ui');
  const position = { anchorKey: '', anchorTop: 0, scrollTop: 240 };
  const view = render(<TranscriptScrollPositionContext.Provider value={() => position}>{renderer.renderRoot(host, {})}</TranscriptScrollPositionContext.Provider>);
  expect(receivedPosition).toHaveBeenLastCalledWith(position);
  expect(upstreamRead).not.toHaveBeenCalled();
  expect(screen.getByText('native:user:1')).toBeTruthy();
  expect(screen.getByText('borrowed images')).toBeTruthy();
  let off!: () => void;
  const plugin = vi.fn((props: any) => <span>plugin:{props.node.data.text}</span>);
  await act(async () => { off = core.register({ name: 'conversation.chat.node', key: 'user' }, plugin); });
  expect(requested.getSnapshot()).toBe(true);
  expect(screen.getByText('plugin:real projected node')).toBeTruthy();
  expect(plugin.mock.calls.at(-1)?.[0].node).toBe(node);
  await act(async () => off());
  expect(requested.getSnapshot()).toBe(false);
  expect(screen.getByText('native:user:1')).toBeTruthy();
  view.unmount();
});
