import { describe, expect, it, vi } from "vitest";
import type { ConversationInputActions } from "@amiba/extension-sdk";
import { createInputActionsProvider } from "./input-actions-provider.js";
import { createInputTriggerBridge } from "./input-trigger-bridge.js";

function fixture() {
  const bridge = createInputTriggerBridge({
    scopeOf: () => ({ on: () => () => {} }) as never,
    subscribeSessions: () => () => {}, inputTriggers: () => undefined, commandUi: () => undefined,
  });
  const provider = createInputActionsProvider(bridge);
  const actions = (sessionId: string) => provider.resolve({ sessionId } as never).props!.inputActions as ConversationInputActions;
  const bind = (sessionId: string) => {
    let draft = "initial";
    const edit = vi.fn((text: string) => { draft = text; return true; });
    const off = bridge.bindEditor(sessionId, {
      beginCommand: () => false, insertReference: () => false, consumeToken: () => false, insertText: () => false,
      readInputDraft: () => ({ draft, draftRev: 0, occurrences: [], phase: "plain" }), editInputDraft: edit,
    });
    return { edit, off, read: () => draft };
  };
  return { bridge, provider, actions, bind };
}

describe("official input action provider", () => {
  it("retains stable actions and targets only their session's current editor", () => {
    const { actions, bind } = fixture();
    const first = bind("a"), other = bind("b"), action = actions("a");
    expect(actions("a")).toBe(action);
    action.setDraft("first edit");
    expect(first.read()).toBe("first edit");
    expect(other.read()).toBe("initial");
    const replacement = bind("a");
    first.off();
    action.setDraft("replacement edit");
    expect(replacement.read()).toBe("replacement edit");
    expect(first.read()).toBe("first edit");
    replacement.off();
    expect(() => action.setDraft("unmounted")).toThrow("not mounted");
    expect(other.read()).toBe("initial");
  });

  it("does not invoke edits for unchanged drafts and exposes unavailable image admission", () => {
    const { actions, bind } = fixture();
    const editor = bind("a"), action = actions("a");
    action.setDraft("initial");
    expect(editor.edit).not.toHaveBeenCalled();
    editor.edit.mockReturnValue(false);
    expect(() => action.setDraft("rejected")).toThrow("cannot accept");
    expect(action.addImages([])).toBe(false);
  });

  it("routes submission to the live native binding without promising completion", () => {
    const { actions, bridge } = fixture();
    const submit = vi.fn(() => true);
    const off = bridge.bindSubmit!("a", submit);
    expect(actions("a").submit()).toBeUndefined();
    expect(submit).toHaveBeenCalledTimes(1);
    actions("b").submit();
    off();
    actions("a").submit();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
