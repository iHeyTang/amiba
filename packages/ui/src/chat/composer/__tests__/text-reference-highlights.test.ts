import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandClaimStore } from "../triggers/claim";
import type { CommandClaim } from "../triggers/contracts";
import { commandTokenRanges, subscribeCommandTokenHighlight, subscribeTextReferenceHighlights, textReferenceRanges } from "../triggers/text-reference-highlights";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe("official plain-text lexicon decorations", () => {
  it("matches the rc.2 boundaries, folders and exact names without inventing occurrences", () => {
    const draft = "x/plan /plan.md /unknown @agent @agents @folder/ @\"two words/\"";
    expect(textReferenceRanges(draft, new Map([["/", ["plan"]], ["@", ["agent"]]]))
      .map(range => draft.slice(range.start, range.end)))
      .toEqual(["/plan", "@agent", "@folder/", '@"two words/']);
    expect(textReferenceRanges("@foo/", new Map([["@", ["foo"]]]))).toEqual([{ start: 0, end: 4 }]);
  });

  it("repaints asynchronous rolls across split text nodes without changing the editor, and disposes independently", () => {
    const highlights = new Map<string, { ranges: Range[] }>();
    vi.stubGlobal("CSS", { highlights });
    vi.stubGlobal("Highlight", class { constructor(...publicRanges: Range[]) { this.ranges = publicRanges; } ranges: Range[]; });
    const editor = createEditor({ namespace: "lexicon-test", onError: error => { throw error; } });
    const root = document.createElement("div");
    document.body.append(root);
    editor.setRootElement(root);
    editor.update(() => {
      $getRoot().append($createParagraphNode().append($createTextNode("/pl"), $createTextNode("an @agent").toggleFormat("bold")));
    }, { discrete: true });
    let names: ReadonlyMap<"/" | "@", readonly string[]> = new Map();
    const listeners = new Set<() => void>();
    const store = { getSnapshot: () => names, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
    const before = editor.getEditorState();
    const changed = vi.fn();
    const offUpdates = editor.registerUpdateListener(changed);
    const off = subscribeTextReferenceHighlights(editor, store);
    const unrelated = { ranges: [] };
    highlights.set("another-editor", unrelated);
    names = new Map([["/", ["plan"]], ["@", ["agent"]]]);
    listeners.forEach(fn => fn());
    const own = [...highlights.values()].find(value => value !== unrelated)!;
    expect(own.ranges.map(range => range.toString())).toEqual(["/pl", "an", "@agent"]);
    expect(editor.getEditorState()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    names = new Map();
    listeners.forEach(fn => fn());
    expect([...highlights.values()].find(value => value !== unrelated)!.ranges).toEqual([]);
    off();
    expect(listeners.size).toBe(0);
    expect([...highlights.keys()]).toEqual(["another-editor"]);
    expect(document.head.querySelector("style")?.textContent ?? "").not.toContain("amiba-text-reference-");
    offUpdates();
    editor.setRootElement(null);
  });
});

describe("slash-command claim token decoration", () => {
  it("highlights exactly the trimmed leading command token and nothing when there is no claim", () => {
    expect(commandTokenRanges(undefined)).toEqual([]);
    expect(commandTokenRanges("/goal ")).toEqual([{ start: 0, end: 5 }]);
    expect(commandTokenRanges("/status")).toEqual([{ start: 0, end: 7 }]);
  });

  it("paints the claimed token, clears on release, and disposes independently", () => {
    const highlights = new Map<string, { ranges: Range[] }>();
    vi.stubGlobal("CSS", { highlights });
    vi.stubGlobal("Highlight", class { constructor(...publicRanges: Range[]) { this.ranges = publicRanges; } ranges: Range[]; });
    const editor = createEditor({ namespace: "command-token-test", onError: error => { throw error; } });
    const root = document.createElement("div");
    document.body.append(root);
    editor.setRootElement(root);
    editor.update(() => {
      $getRoot().append($createParagraphNode().append($createTextNode("/goal rest")));
    }, { discrete: true });
    const claims = new CommandClaimStore();
    const claim = { token: "/goal " } as unknown as CommandClaim;
    const before = editor.getEditorState();
    const changed = vi.fn();
    const offUpdates = editor.registerUpdateListener(changed);
    const off = subscribeCommandTokenHighlight(editor, claims);
    const unrelated = { ranges: [] };
    highlights.set("another-editor", unrelated);
    claims.begin(claim);
    const own = [...highlights.values()].find(value => value !== unrelated)!;
    expect(own.ranges.map(range => range.toString())).toEqual(["/goal"]);
    expect(editor.getEditorState()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    claims.release();
    expect([...highlights.values()].find(value => value !== unrelated)!.ranges).toEqual([]);
    off();
    expect([...highlights.keys()]).toEqual(["another-editor"]);
    expect(document.head.querySelector("style")?.textContent ?? "").not.toContain("amiba-command-token-");
    offUpdates();
    editor.setRootElement(null);
  });
});
