import { expect, it, vi } from "vitest";
import type { StorageAdapter } from "@amiba/app-runtime/platform";
import { composerDraftDisplayText } from "../composer-draft-document";
import { createComposerDraftSource, sessionComposerDraft } from "../composer-draft-store";

function storage() {
  const values: Record<string, unknown> = {};
  const listeners = new Set<(changes: Record<string, { newValue?: unknown }>) => void>();
  const adapter: StorageAdapter = {
    get: vi.fn(async () => ({ ...values })),
    set: vi.fn(async patch => { Object.assign(values, patch); for (const listener of listeners) listener(Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,{newValue:v}]))); }),
    remove: vi.fn(async keys => { for(const key of typeof keys === "string" ? [keys] : keys) { delete values[key]; for (const listener of listeners) listener({[key]:{}}); } }),
    watch: vi.fn((_keys, listener) => { listeners.add(listener); return () => listeners.delete(listener); }),
  };
  return { adapter, values, listeners };
}
const tick = () => new Promise(resolve => setTimeout(resolve,0));

it("restores lossless canonical tokens and keeps each session's setters addressed", async () => {
  const {adapter, values} = storage();
  const text = "Before @[dsh.reference:files|a%7Cb|中文😀|clipboard%5D] after";
  const one = sessionComposerDraft(adapter,"one"), two = sessionComposerDraft(adapter,"two");
  const offOne = one.subscribe(()=>{}), offTwo = two.subscribe(()=>{});
  one.set(text); two.set("Other draft");
  const oldSet = one.set;
  oldSet(previous => previous + "!");
  await tick();
  expect(two.getSnapshot()).toBe("Other draft");
  expect(sessionComposerDraft(adapter,"one")).toBe(one);
  const restored = createComposerDraftSource(adapter,"one");
  const off = restored.subscribe(()=>{});
  await tick();
  expect(restored.getSnapshot()).toBe(text + "!");
  expect(values["amiba.composer.draft.one"]).toEqual({version:2,...one.getDocument()});
  off(); offOne(); offTwo();
});

it("does not overwrite an edit or explicit clear with a delayed initial read", async () => {
  for (const next of ["New typed text", ""]) {
    const {adapter} = storage();
    let resolve!: (value:Record<string,unknown>)=>void;
    adapter.get = vi.fn(()=>new Promise<Record<string,unknown>>(done=>{resolve=done;}));
    const source = createComposerDraftSource(adapter,"session");
    const off = source.subscribe(()=>{});
    source.set(next);
    resolve({"amiba.composer.draft.session":{version:1,text:"Old disk draft"}});
    await tick();
    expect(source.getSnapshot()).toBe(next);
    off();
  }
});

it("serializes writes so an older completion cannot win over the new draft", async () => {
  const {adapter} = storage();
  let finish!:()=>void;
  adapter.set = vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const source = createComposerDraftSource(adapter,"session");
  const off = source.subscribe(()=>{});
  source.set("first"); source.set("second"); source.set("");
  await tick();
  expect(adapter.set).toHaveBeenCalledTimes(1);
  finish(); await tick();
  expect(adapter.set).toHaveBeenLastCalledWith({"amiba.composer.draft.session":{version:2,text:"second",parts:[{kind:"text",text:"second"}]}});
  finish(); await tick();
  expect(adapter.remove).toHaveBeenCalledWith("amiba.composer.draft.session");
  expect(source.getSnapshot()).toBe(""); off();
});

it("releases watches, observes external edits, and ignores malformed stored values", async () => {
  const {adapter,values,listeners} = storage();
  values["amiba.composer.draft.session"]={version:2,text:"unsupported"};
  const source=createComposerDraftSource(adapter,"session");
  const off=source.subscribe(()=>{});
  await tick(); expect(source.getSnapshot()).toBe("");
  await adapter.set({"amiba.composer.draft.session":{version:1,text:"external"}});
  expect(source.getSnapshot()).toBe("external");
  off(); expect(listeners.size).toBe(0);
  await adapter.remove("amiba.composer.draft.session");
  const offAgain=source.subscribe(()=>{});
  await tick(); expect(source.getSnapshot()).toBe("");
  offAgain();
});

it("ignores an older hydration after the same session is reopened", async () => {
  const {adapter}=storage();
  const reads: Array<(value:Record<string,unknown>)=>void>=[];
  adapter.get=vi.fn(()=>new Promise<Record<string,unknown>>(resolve=>reads.push(resolve)));
  const source=createComposerDraftSource(adapter,"session");
  const off=source.subscribe(()=>{}); off();
  const offAgain=source.subscribe(()=>{});
  reads[1]({"amiba.composer.draft.session":{version:1,text:"latest disk value"}});
  await tick();
  reads[0]({"amiba.composer.draft.session":{version:1,text:"obsolete disk value"}});
  await tick(); expect(source.getSnapshot()).toBe("latest disk value");
  offAgain();
});

it("does not start an obsolete disk restore when an offscreen edit is still saving", async () => {
  const {adapter}=storage();
  let finish!:()=>void;
  adapter.set=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const source=createComposerDraftSource(adapter,"session");
  source.set("offscreen edit");
  const off=source.subscribe(()=>{});
  expect(adapter.get).not.toHaveBeenCalled();
  await tick(); finish(); await tick();
  expect(source.getSnapshot()).toBe("offscreen edit"); off();
});


it("persists literal token text separately from real references and keeps editor echoes lossless", async () => {
  const { adapter } = storage();
  const source = createComposerDraftSource(adapter, "session");
  const token = "@[dsh.reference:files|id|Label|clip]";
  source.setParts([{ kind: "text", text: token }]);
  const document = source.getDocument();
  source.set(token); // onChange echoes the editor's canonical string.
  expect(source.getDocument()).toBe(document);
  source.set(previous => previous + "!");
  expect(source.getDocument().parts).toEqual([{ kind: "text", text: token + "!" }]);
  await tick();
  const restored = createComposerDraftSource(adapter, "session");
  const off = restored.subscribe(() => {});
  await tick();
  expect(restored.getDocument()).toEqual(source.getDocument());
  expect(restored.getDocument().parts[0].kind).toBe("text");
  off();
});

it("publishes a node-kind change even when the canonical text stays identical", () => {
  const source = createComposerDraftSource();
  const token = "@[dsh.reference:files|id|Label|clip]";
  source.set(token);
  const before = source.getDocument();
  const changed = vi.fn();
  source.subscribe(changed);
  source.setParts([{ kind: "text", text: token }]);
  expect(source.getSnapshot()).toBe(token);
  expect(source.getDocument()).not.toBe(before);
  expect(changed).toHaveBeenCalledTimes(1);
  source.setParts([{ kind: "text", text: token }]);
  expect(changed).toHaveBeenCalledTimes(1);
});


it("persists public text edits without interpreting new token-shaped text as a reference", async () => {
  const {adapter}=storage();
  const source=createComposerDraftSource(adapter,"public");
  const off=source.subscribe(()=>{});
  source.set("@[dsh.reference:files|id|Label|clip]");
  const text="prefix @Label literal @[dsh.reference:missing|id|literal|clip]";
  source.setDisplayText("prefix @Label");
  source.setDisplayText(text);
  await tick();
  const restored=createComposerDraftSource(adapter,"public"),offRestored=restored.subscribe(()=>{});
  await tick();
  expect(composerDraftDisplayText(restored.getDocument())).toBe(text);
  expect(restored.getDocument().parts.filter(part=>part.kind==="mention")).toHaveLength(1);
  restored.setDisplayText(text.replace("@Label","@Edited"));
  expect(restored.getDocument().parts).toEqual([{kind:"text",text:text.replace("@Label","@Edited")}]);
  offRestored();off();
});
