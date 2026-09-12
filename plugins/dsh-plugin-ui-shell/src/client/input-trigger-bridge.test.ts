/**
 * The bail-listener wiring — the half that makes `registerSource` honest.
 *
 * The property under test is the HARD CONTRACT: each of the four scoped
 * `slash/input-*` listeners answers `true` ONLY when the editor verb it
 * delegates to reports an applied mutation, and `undefined` otherwise. The
 * official controller reads `actx.bail(...) === true` to decide whether a
 * pick landed, so a listener that always returns `true` would lie to every
 * plugin author.
 */

import { describe, expect, it, vi } from "vitest";
import { createInputTriggerBridge } from "./input-trigger-bridge.js";

type Listener = (request: unknown) => true | undefined;

/** A session-scope ctx double: records listeners and replays a bail. */
function scopeDouble() {
  const listeners = new Map<string, Listener[]>();
  return {
    ctx: {
      on(event: string, listener: Listener) {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
        return () => {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((entry) => entry !== listener),
          );
        };
      },
    },
    /** What `InputTriggerController.execute` does: bail and compare to true. */
    bail(event: string, request: unknown): boolean {
      for (const listener of listeners.get(event) ?? []) {
        const answer = listener(request);
        if (answer !== undefined) return answer === true;
      }
      return false;
    },
    count(event: string): number {
      return (listeners.get(event) ?? []).length;
    },
  };
}

function opsDouble(applied: boolean) {
  return {
    beginCommand: vi.fn(() => applied),
    insertReference: vi.fn(() => applied),
    consumeToken: vi.fn(() => applied),
    insertText: vi.fn(() => applied),
  };
}

const SPAN = { start: 0, end: 3, draftRev: 1 };
const CLAIM = { token: "/goal ", submit: async () => ({ kind: "success" as const }) };

function bridgeOver(scope: ReturnType<typeof scopeDouble>) {
  return createInputTriggerBridge({
    scopeOf: () => scope.ctx as never,
    subscribeSessions: () => () => {},
    inputTriggers: () => undefined,
    commandUi: () => undefined,
  });
}

describe("the four scoped bail listeners", () => {
  it("answers true for each verb only when the editor actually applied", () => {
    const scope = scopeDouble();
    const bridge = bridgeOver(scope);
    const ops = opsDouble(true);
    const dispose = bridge.bindEditor("s1", ops);

    expect(scope.bail("slash/input-begin-command", { claim: CLAIM, span: SPAN })).toBe(true);
    expect(
      scope.bail("slash/input-insert-reference", {
        reference: { source: "s", ref: "r", label: "l", clipboardText: "c" },
        span: SPAN,
      }),
    ).toBe(true);
    expect(
      scope.bail("slash/input-consume-token", {
        guard: { kind: "span", span: SPAN },
      }),
    ).toBe(true);
    expect(scope.bail("slash/input-insert-text", { text: "/x ", span: SPAN })).toBe(true);

    expect(ops.beginCommand).toHaveBeenCalledWith(CLAIM, SPAN);
    expect(ops.insertText).toHaveBeenCalledWith("/x ", SPAN);
    dispose();
  });

  it("answers FALSE (bail sees undefined) for every verb the editor did not apply", () => {
    // The acceptance criterion: drive a no-op outcome, assert false.
    const scope = scopeDouble();
    const bridge = bridgeOver(scope);
    const dispose = bridge.bindEditor("s1", opsDouble(false));

    expect(scope.bail("slash/input-begin-command", { claim: CLAIM, span: SPAN })).toBe(false);
    expect(
      scope.bail("slash/input-insert-reference", {
        reference: { source: "s", ref: "r", label: "l", clipboardText: "c" },
        span: SPAN,
      }),
    ).toBe(false);
    expect(
      scope.bail("slash/input-consume-token", {
        guard: { kind: "bare-token", token: "/x" },
      }),
    ).toBe(false);
    expect(scope.bail("slash/input-insert-text", { text: "/x ", span: SPAN })).toBe(false);
    dispose();
  });

  it("mounts the listeners only while an editor is bound", () => {
    const scope = scopeDouble();
    const bridge = bridgeOver(scope);
    expect(scope.count("slash/input-insert-text")).toBe(0);
    const dispose = bridge.bindEditor("s1", opsDouble(true));
    expect(scope.count("slash/input-insert-text")).toBe(1);
    dispose();
    // No listener means the controller's bail returns undefined, which it
    // correctly reads as "not applied" — better than a listener that guesses.
    expect(scope.count("slash/input-insert-text")).toBe(0);
    expect(scope.bail("slash/input-insert-text", { text: "x", span: SPAN })).toBe(false);
  });

  it("binds nothing for a session with no live scope", () => {
    const bridge = createInputTriggerBridge({
      scopeOf: () => undefined,
      subscribeSessions: () => () => {},
      inputTriggers: () => undefined,
      commandUi: () => undefined,
    });
    expect(() => bridge.bindEditor("s1", opsDouble(true))()).not.toThrow();
  });
});

describe("service resolution", () => {
  it("projects the same official source onto drafts and removes it on disposal", () => {
    const off = vi.fn(), registerSource = vi.fn(() => off), listener = vi.fn();
    const bridge = createInputTriggerBridge({ scopeOf: () => undefined, subscribeSessions: () => () => {}, inputTriggers: () => ({ registerSource, sessionOf: () => { throw new Error("must not invent a session"); } }), commandUi: () => undefined });
    const source = { trigger: "@", name: "resources" } as never;
    bridge.subscribe!(listener); const dispose = bridge.registerSources([source], true);
    expect(registerSource).toHaveBeenCalledWith(source); expect(bridge.draftSources!()).toEqual([source]); expect(bridge.controllerFor("")).toBeUndefined();
    dispose(); expect(bridge.draftSources!()).toEqual([]); expect(off).toHaveBeenCalledOnce(); expect(listener).toHaveBeenCalledTimes(2);
  });
  it("reports no controller and no popup while the official rows are absent", () => {
    const bridge = createInputTriggerBridge({
      scopeOf: () => ({}) as never,
      subscribeSessions: () => () => {},
      inputTriggers: () => undefined,
      commandUi: () => undefined,
    });
    expect(bridge.controllerFor("s1")).toBeUndefined();
    expect(bridge.popupFor("s1")).toBeUndefined();
    expect(bridge.registerSources([])).toBeTypeOf("function");
  });

  it("registers Amiba's sources with the official service and disposes them", () => {
    const disposers = [vi.fn(), vi.fn()];
    let index = 0;
    const registerSource = vi.fn(() => disposers[index++]);
    const bridge = createInputTriggerBridge({
      scopeOf: () => ({}) as never,
      subscribeSessions: () => () => {},
      inputTriggers: () => ({ registerSource, sessionOf: () => ({}) as never }),
      commandUi: () => undefined,
    });
    const dispose = bridge.registerSources([
      { trigger: "/", name: "a" } as never,
      { trigger: "@", name: "b" } as never,
    ]);
    expect(registerSource).toHaveBeenCalledTimes(2);
    dispose();
    expect(disposers[0]).toHaveBeenCalled();
    expect(disposers[1]).toHaveBeenCalled();
  });

  it("treats a scope-less session as an empty seat, not an error", () => {
    const bridge = createInputTriggerBridge({
      scopeOf: () => ({}) as never,
      subscribeSessions: () => () => {},
      inputTriggers: () => ({
        registerSource: () => () => {},
        sessionOf: () => {
          throw new Error("slash.sessionOf requires a session scope");
        },
      }),
      commandUi: () => undefined,
    });
    expect(bridge.controllerFor("s1")).toBeUndefined();
  });

  it("runs a claim's submit against the REAL session scope", async () => {
    const actx = { marker: "scope" };
    const submit = vi.fn(async () => ({ kind: "success" as const }));
    const bridge = createInputTriggerBridge({
      scopeOf: () => actx as never,
      subscribeSessions: () => () => {},
      inputTriggers: () => undefined,
      commandUi: () => undefined,
    });
    await bridge.submitClaim!("s1", { token: "/goal ", submit }, "ship it");
    expect(submit).toHaveBeenCalledWith("ship it", actx, []);
  });

  it("forwards actual command images and refuses claims without image support", async () => {
    const scope = scopeDouble();
    const bridge = bridgeOver(scope);
    const submit = vi.fn(async () => ({ kind: "success" as const }));
    const images = [{ mediaType: "image/png" as const, data: "AQID", name: "photo.png" }];
    await bridge.submitClaim!("s1", { token: "/image ", images: true, submit }, "describe", images);
    expect(submit).toHaveBeenCalledWith("describe", scope.ctx, images);
    submit.mockClear();
    await expect(bridge.submitClaim!("s1", { token: "/plain ", submit }, "describe", images)).rejects.toThrow("does not accept images");
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects a claim submit for a session with no scope", async () => {
    const bridge = createInputTriggerBridge({
      scopeOf: () => undefined,
      subscribeSessions: () => () => {},
      inputTriggers: () => undefined,
      commandUi: () => undefined,
    });
    await expect(
      bridge.submitClaim!("s1", { token: "/x ", submit: async () => ({ kind: "success" }) }, ""),
    ).rejects.toThrow(/resolved no scope/u);
  });
});


it("exposes only the current bound editor's input projection", () => {
  const bridge=bridgeOver(scopeDouble());
  const first={draft:"first",draftRev:1,occurrences:[]};
  const second={draft:"second",draftRev:2,occurrences:[]};
  expect(bridge.inputDraftFor("s1")).toBeUndefined();
  const disposeFirst=bridge.bindEditor("s1",{...opsDouble(true),readInputDraft:()=>first});
  expect(bridge.inputDraftFor("s1")).toBe(first);
  expect(bridge.inputDraftFor("s2")).toBeUndefined();
  const disposeSecond=bridge.bindEditor("s1",{...opsDouble(true),readInputDraft:()=>second});
  disposeFirst();
  expect(bridge.inputDraftFor("s1")).toBe(second);
  disposeSecond();
  expect(bridge.inputDraftFor("s1")).toBeUndefined();
});


it("streams input snapshots through edit, replacement and detach without stale editor events", () => {
  const scope=scopeDouble();
  const bridge=bridgeOver(scope);
  const source=bridge.inputDraftSource("s1");
  expect(bridge.inputDraftSource("s1")).toBe(source);
  const seen:Array<string|undefined>=[];
  const off=source.subscribe(()=>seen.push(source.getSnapshot()?.draft));
  let draft={draft:"one",draftRev:0,occurrences:[]};
  let emit!:()=>void;
  const unsubscribe=vi.fn();
  const oldOps={...opsDouble(true),readInputDraft:()=>draft,subscribeInputDraft:(listener:()=>void)=>{emit=listener;return unsubscribe;}};
  const oldDispose=bridge.bindEditor("s1",oldOps);
  expect(seen).toEqual(["one"]);
  draft={...draft,draft:"two",draftRev:1};
  emit();
  expect(seen).toEqual(["one","two"]);
  const newOps={...opsDouble(true),readInputDraft:()=>({draft:"replacement",draftRev:0,occurrences:[]})};
  const dispose=bridge.bindEditor("s1",newOps);
  emit(); // The old editor is still mounted briefly during replacement.
  expect(seen).toEqual(["one","two","replacement"]);
  expect(scope.bail("slash/input-insert-text",{text:"x",span:SPAN})).toBe(true);
  expect(oldOps.insertText).not.toHaveBeenCalled();
  expect(newOps.insertText).toHaveBeenCalledOnce();
  oldDispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(source.getSnapshot()?.draft).toBe("replacement");
  dispose();
  expect(seen).toEqual(["one","two","replacement",undefined]);
  off();
  const another=bridge.bindEditor("s1",newOps);
  expect(seen).toHaveLength(4);
  another();
});

it("does not broadcast another session's input changes", () => {
  const bridge=bridgeOver(scopeDouble());
  const listener=vi.fn();
  const off=bridge.inputDraftSource("s1").subscribe(listener);
  const detach=bridge.bindEditor("s2",opsDouble(true));
  detach();
  expect(listener).not.toHaveBeenCalled();
  off();
});


it("keeps a replacement binding even when it reuses the same editor operations", () => {
  const bridge=bridgeOver(scopeDouble());
  const snapshot={draft:"same",draftRev:0,occurrences:[]};
  const ops={...opsDouble(true),readInputDraft:()=>snapshot};
  const oldDispose=bridge.bindEditor("s1",ops);
  const newDispose=bridge.bindEditor("s1",ops);
  oldDispose();
  expect(bridge.inputDraftFor("s1")).toBe(snapshot);
  newDispose();
  expect(bridge.inputDraftFor("s1")).toBeUndefined();
});

it("does not remove newer listeners when an old subscription is disposed twice", () => {
  const bridge=bridgeOver(scopeDouble());
  const source=bridge.inputDraftSource("s1");
  const oldOff=source.subscribe(()=>{});
  oldOff();
  const listener=vi.fn();
  const off=source.subscribe(listener);
  oldOff();
  const detach=bridge.bindEditor("s1",opsDouble(true));
  expect(listener).toHaveBeenCalledOnce();
  off();
  detach();
});


it("routes public draft writes to the current session editor and reports absence", () => {
  const bridge=bridgeOver(scopeDouble());
  expect(bridge.setInputDraft("s1","new")).toBe(false);
  const setInputDraft=vi.fn(()=>true);
  const dispose=bridge.bindEditor("s1",{...opsDouble(true),setInputDraft});
  expect(bridge.setInputDraft("s2","wrong")).toBe(false);
  expect(bridge.setInputDraft("s1","new",12)).toBe(true);
  expect(setInputDraft).toHaveBeenCalledWith("new",12);
  dispose();
  expect(bridge.setInputDraft("s1","detached")).toBe(false);
});
