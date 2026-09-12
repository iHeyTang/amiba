/**
 * The APPLIED-TRUTH contract of the four scoped `slash/input-*` verbs.
 *
 * A listener that always returns `true` is a silent lie to every plugin
 * author: the official controller reads that answer to decide whether a pick
 * landed. So each verb is driven here in both directions — a real mutation
 * (true) and a no-op / rejected transaction (false).
 */

import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalNode,
} from "lexical";
import { describe, expect, it, vi } from "vitest";
import { MentionNode } from "../MentionNode";
import type { MentionData } from "../providers/types";
import { CommandClaimStore } from "../triggers/claim";
import {
  DraftRevision,
  createTriggerEditorOps,
  REFERENCE_MENTION_TYPE,
} from "../triggers/editor-ops";
import { $scanDraft, PLACEHOLDER } from "../triggers/lexical-draft";
import type { CommandClaim, TokenSpan } from "../triggers/contracts";

function makeEditor(initial: string) {
  const editor = createEditor({
    namespace: "trigger-ops-test",
    nodes: [MentionNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      if (initial) paragraph.append($createTextNode(initial));
      root.append(paragraph);
    },
    { discrete: true },
  );
  return editor;
}

function draftOf(editor: ReturnType<typeof makeEditor>): string {
  let draft = "";
  editor.getEditorState().read(() => {
    draft = $scanDraft().draft;
  });
  return draft;
}

/** The single mention chip in the tree, or null. */
function onlyMention(editor: ReturnType<typeof makeEditor>): MentionData | null {
  const found: MentionData[] = [];
  editor.getEditorState().read(() => {
    const walk = (node: LexicalNode): void => {
      if (node instanceof MentionNode) found.push(node.getMention());
      else if ($isElementNode(node)) for (const child of node.getChildren()) walk(child);
    };
    walk($getRoot());
  });
  return found[0] ?? null;
}

function setup(initial: string) {
  const editor = makeEditor(initial);
  const claims = new CommandClaimStore();
  const revision = new DraftRevision();
  const ops = createTriggerEditorOps(editor, claims, revision);
  return { editor, claims, revision, ops };
}

const span = (start: number, end: number, draftRev = 0): TokenSpan => ({
  start,
  end,
  draftRev,
});

const claimOf = (token: string): CommandClaim => ({
  token,
  submit: async () => ({ kind: "success" }),
});

describe("insertText", () => {
  it("applies over the token span and reports true", () => {
    const { editor, ops } = setup("/mod");
    expect(ops.insertText("/model ", span(0, 4))).toBe(true);
    expect(draftOf(editor)).toBe("/model ");
  });

  it("reports FALSE on a stale draftRev (span CAS miss) and leaves the draft alone", () => {
    const { editor, ops } = setup("/mod");
    expect(ops.insertText("/model ", span(0, 4, 9))).toBe(false);
    expect(draftOf(editor)).toBe("/mod");
  });

  it("reports FALSE for a NO-OP splice — the acceptance-criterion case", () => {
    // The CAS passes, the transaction runs, and the result is byte-identical.
    // Upstream's revision counter would call this applied; observing the tree
    // says otherwise, and the honest answer is what the source is told.
    const { editor, ops } = setup("/mod");
    expect(ops.insertText("/mod", span(0, 4))).toBe(false);
    expect(draftOf(editor)).toBe("/mod");
  });

  it("reports FALSE for an out-of-bounds span", () => {
    const { ops } = setup("/mod");
    expect(ops.insertText("x", span(0, 99))).toBe(false);
    expect(ops.insertText("x", span(3, 1))).toBe(false);
  });
});

describe("insertReference", () => {
  it("replaces the span with ONE placeholder chip plus a separating space", () => {
    const { editor, ops } = setup("hi @tr");
    expect(
      ops.insertReference(
        {
          source: "session",
          ref: "s1",
          label: "Login refactor",
          clipboardText: "@Login refactor",
        },
        span(3, 6),
      ),
    ).toBe(true);
    expect(draftOf(editor)).toBe(`hi ${PLACEHOLDER} `);
    // The chip carries the official occurrence payload, so submit-time
    // serialization can route it back to the owning source's codec.
    expect(onlyMention(editor)?.payload).toEqual({
      source: "session",
      ref: "s1",
      label: "Login refactor",
      clipboardText: "@Login refactor",
    });
  });

  it("keeps a single space when one already follows", () => {
    const { editor, ops } = setup("hi @tr end");
    expect(
      ops.insertReference(
        { source: "skill", ref: "x", label: "x", clipboardText: "/x" },
        span(3, 6),
      ),
    ).toBe(true);
    expect(draftOf(editor)).toBe(`hi ${PLACEHOLDER} end`);
  });

  it("reports FALSE on a stale draftRev", () => {
    const { editor, ops } = setup("hi @tr");
    expect(
      ops.insertReference(
        { source: "skill", ref: "x", label: "x", clipboardText: "/x" },
        span(3, 6, 4),
      ),
    ).toBe(false);
    expect(draftOf(editor)).toBe("hi @tr");
  });

  it("mints the official reference mention type", () => {
    const { editor, ops } = setup("@a");
    ops.insertReference(
      { source: "skill", ref: "x", label: "x", clipboardText: "/x" },
      span(0, 2),
    );
    expect(onlyMention(editor)?.type).toBe(REFERENCE_MENTION_TYPE);
  });
});

describe("beginCommand", () => {
  it("takes the head of the draft, enters command mode, reports true", () => {
    const { editor, claims, ops } = setup("/goal");
    expect(ops.beginCommand(claimOf("/goal "), span(0, 5))).toBe(true);
    expect(draftOf(editor)).toBe("/goal ");
    expect(claims.get()?.token).toBe("/goal ");
  });

  it("preserves the tail after the span, exactly as upstream does", () => {
    const { editor, ops } = setup("/go rest");
    expect(ops.beginCommand(claimOf("/goal "), span(0, 3))).toBe(true);
    expect(draftOf(editor)).toBe("/goal  rest");
  });

  it("REFUSES a non-leading span and does not enter command mode", () => {
    const { editor, claims, ops } = setup("hi /goal");
    expect(ops.beginCommand(claimOf("/goal "), span(3, 8))).toBe(false);
    expect(draftOf(editor)).toBe("hi /goal");
    expect(claims.get()).toBeNull();
  });

  it("reports FALSE on a stale draftRev", () => {
    const { claims, ops } = setup("/goal");
    expect(ops.beginCommand(claimOf("/goal "), span(0, 5, 3))).toBe(false);
    expect(claims.get()).toBeNull();
  });
});

describe("consumeToken", () => {
  it("splices out an exact span", () => {
    const { editor, ops } = setup("/plan tail");
    expect(
      ops.consumeToken({ kind: "span", span: span(0, 5) }),
    ).toBe(true);
    expect(draftOf(editor)).toBe(" tail");
  });

  it("reports FALSE for an empty span and for a stale one", () => {
    const { ops } = setup("/plan");
    expect(ops.consumeToken({ kind: "span", span: span(2, 2) })).toBe(false);
    expect(ops.consumeToken({ kind: "span", span: span(0, 5, 7) })).toBe(false);
  });

  it("clears the draft on a matching bare token", () => {
    const { editor, ops } = setup("  /plan  ");
    expect(ops.consumeToken({ kind: "bare-token", token: "/plan" })).toBe(true);
    expect(draftOf(editor)).toBe("");
  });

  it("reports FALSE when the bare token no longer matches", () => {
    const { editor, ops } = setup("/plan now");
    expect(ops.consumeToken({ kind: "bare-token", token: "/plan" })).toBe(false);
    expect(draftOf(editor)).toBe("/plan now");
    expect(ops.consumeToken({ kind: "bare-token", token: "" })).toBe(false);
  });
});

describe("the claim integrity watch", () => {
  it("releases command mode as soon as the token prefix breaks", () => {
    const claims = new CommandClaimStore();
    claims.begin(claimOf("/goal "));
    claims.watch("/goal ship it");
    expect(claims.get()).not.toBeNull();
    claims.watch("/goa");
    expect(claims.get()).toBeNull();
  });
});


describe("public input draft projection", () => {
  it("keeps full display offsets and distinct stable identities without changing trigger coordinates", () => {
    const {editor,ops,revision}=setup("");
    const ref={source:"fixture",ref:"same",label:"文档",clipboardText:"@original"};
    expect(ops.insertReference(ref,span(0,0))).toBe(true);
    expect(ops.insertReference(ref,span(2,2))).toBe(true);
    const first=ops.readInputDraft!();
    expect(first.draft).toBe("@文档 @文档 ");
    expect(first.occurrences.map(item=>[item.offset,item.length,item.clipboardText])).toEqual([[0,3,"@original"],[4,3,"@original"]]);
    expect(first.occurrences[0].occurrenceId).not.toBe(first.occurrences[1].occurrenceId);
    expect(ops.readInputDraft!()).toBe(first);
    expect(draftOf(editor)).toBe(`${PLACEHOLDER} ${PLACEHOLDER} `);
    expect(ops.insertText("😀 ",span(0,0))).toBe(true);
    revision.bump();
    const next=ops.readInputDraft!();
    expect(next.draftRev).toBe(1);
    expect(next.occurrences.map(item=>item.offset)).toEqual([3,7]);
    expect(next.occurrences.map(item=>item.occurrenceId)).toEqual(first.occurrences.map(item=>item.occurrenceId));
    expect(first.draft).toBe("@文档 @文档 ");
    expect(Object.isFrozen(next.occurrences[0])).toBe(true);
  });

  it("preserves native tokens and paragraph boundaries without inventing reference owners", () => {
    const {editor,ops}=setup("Before");
    editor.update(()=>{
      const paragraph=$createParagraphNode();
      paragraph.append(new MentionNode({type:"file",payload:{path:"notes.txt"},display:"notes.txt"}));
      $getRoot().append(paragraph);
    },{discrete:true});
    expect(ops.readInputDraft!()).toMatchObject({draft:"Before\n\n@[file:notes.txt]",occurrences:[]});
  });
});


it("publishes live editor changes with stable snapshots and an independent public revision", () => {
  const {ops}=setup("first");
  const first=ops.readInputDraft!();
  const notify=vi.fn(()=>ops.readInputDraft!());
  const off=ops.subscribeInputDraft!(notify);
  expect(ops.insertText("!",span(5,5))).toBe(true);
  expect(notify).toHaveBeenCalled();
  const next=ops.readInputDraft!();
  expect(next).toMatchObject({draft:"first!",draftRev:first.draftRev+1});
  expect(ops.readInputDraft!()).toBe(next);
  expect(first.draft).toBe("first");
  notify.mockClear();
  off();
  expect(ops.insertText("?",span(6,6))).toBe(true);
  expect(notify).not.toHaveBeenCalled();
});


it("advances the public revision when edits return to the same draft between reads", () => {
  const {ops}=setup("text");
  const first=ops.readInputDraft!();
  const off=ops.subscribeInputDraft!(()=>{});
  ops.insertText("!",span(4,4));
  ops.insertText("",span(4,5));
  const next=ops.readInputDraft!();
  expect(next.draft).toBe(first.draft);
  expect(next.draftRev).toBe(first.draftRev+2);
  expect(next).not.toBe(first);
  off();
});
