import { describe, expect, it, vi } from "vitest"

import { expandMentionsAsync } from "../expandMentions"
import { registerMentionType } from "../serialize"
import type { TriggerProvider } from "../providers/types"

describe("expandMentionsAsync", () => {
  it("resolves resource content at submission time", async () => {
    registerMentionType("test.resource", ["uri"])
    const provider: TriggerProvider = {
      trigger: "@",
      id: "test",
      ownsType: "test.resource",
      match: () => true,
      search: async () => [],
      onSelect: () => {},
      resolveMention: async (mention) => `<resource>${mention.payload.uri}:fresh</resource>`,
    }
    await expect(
      expandMentionsAsync("Use @[test.resource:doc%25one]", [provider]),
    ).resolves.toBe("Use <resource>doc%one:fresh</resource>")
  })

  it("marks a failed resource explicitly instead of treating the label as content", async () => {
    registerMentionType("broken.resource", ["uri"])
    const provider: TriggerProvider = {
      trigger: "@",
      id: "broken",
      ownsType: "broken.resource",
      match: () => true,
      search: async () => [],
      onSelect: () => {},
      resolveMention: async () => { throw new Error("gone") },
    }
    await expect(expandMentionsAsync("@[broken.resource:x]", [provider])).resolves.toContain(
      "Resource unavailable",
    )
  })
})


it("forwards submission cancellation to official reference codecs", async () => {
  const attempt=new AbortController();
  let resolve!:(text:string)=>void;
  const serializeReference=vi.fn(()=>new Promise<string>(done=>{resolve=done;}));
  const result=expandMentionsAsync("@[dsh.reference:fixture|id|Label|clipboard]",[],{serializeReference},attempt.signal);
  expect(serializeReference).toHaveBeenCalledWith("fixture","id",attempt.signal);
  attempt.abort(new Error("draft changed"));
  // Even an owner ignoring cancellation cannot return an accepted old payload.
  resolve("old resource");
  await expect(result).rejects.toThrow("draft changed");
});

it("does not invoke codecs for an already canceled submission", async () => {
  const attempt=new AbortController();
  attempt.abort(new Error("session changed"));
  const serializeReference=vi.fn();
  await expect(expandMentionsAsync("@[dsh.reference:fixture|id|Label|clipboard]",[],{serializeReference},attempt.signal)).rejects.toThrow("session changed");
  expect(serializeReference).not.toHaveBeenCalled();
});
