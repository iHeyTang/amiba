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
import { OFFICIAL_REPLACEMENTS, OfficialReplacement, NativeOfficialPresentation } from "./official-replacements.js";

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
    scope: () => ({ current: source(binding), resolve: () => binding }),
  };
  const owner = { size: 24, wide: true, width: 240, collapsed: false };
  core.register({ name: "root", children: OFFICIAL_REPLACEMENTS }, ({ renderSlot }: Slots.PropsRenderSlots<keyof typeof OFFICIAL_REPLACEMENTS>) => {
    const fallback = <span>native</span>;
    return <OfficialReplacement fallback={fallback}>{renderSlot(name, owner as never, { fallback })}</OfficialReplacement>;
  });
  core.register({ name, priority: 0 }, () => <span>upstream default</span>);
  core.register({ name, priority: -1 }, NativeOfficialPresentation);
  const view = render(renderer.renderRoot(host, {}));
  expect(screen.getByText("native")).toBeTruthy();
  expect(screen.queryByText("upstream default")).toBeNull();
  let off!: () => void;
  const plugin = vi.fn((_props: object) => <span>plugin</span>);
  await act(async () => { off = core.register({ name, priority: -2 }, plugin); });
  expect(screen.getByText("plugin")).toBeTruthy();
  expect(plugin.mock.calls[0]?.[0]).toEqual(expect.objectContaining(owner));
  expect(screen.queryByText("native")).toBeNull();
  await act(async () => off());
  expect(screen.getByText("native")).toBeTruthy();
  await act(async () => { off = core.register({ name, priority: -2 }, () => null); });
  expect(view.container.textContent).toBe("");
  await act(async () => off());
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => { off = core.register({ name, priority: -2 }, () => { throw new Error("plugin crash"); }); });
    expect(report).toHaveBeenCalled();
    expect(screen.getByText("native")).toBeTruthy();
    await act(async () => off());
  } finally { quiet.mockRestore(); }
});
