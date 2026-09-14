import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyToolDispatchContract } from "./tool-dispatch-contract.mjs";

const source = readFileSync(
  new URL(
    "../plugins/dsh-plugin-ui-shell/src/client/product-shell.tsx",
    import.meta.url,
  ),
  "utf8",
);
test("current tool dispatcher preserves runtime capabilities and native fallback", () => {
  assert.doesNotThrow(() => verifyToolDispatchContract(source));
});

const mutations = [
  [
    "missing dispatcher",
    "const renderToolViewSeat = useCallback(",
    "const removedDispatcher = useCallback(",
  ],
  [
    "wrong callback lifetime",
    "const renderToolViewSeat = useCallback(",
    "const renderToolViewSeat = otherCallback(",
  ],
  ["lost owner", "...request.owner,", "...otherOwner,"],
  [
    "identity overwrite",
    "...request.owner,",
    "...request.owner, callId: otherId,",
  ],
  [
    "wrong loader",
    "{ loadImage: loadMessageImage }",
    "{ loadImage: otherLoader }",
  ],
  [
    "wrong inspector target",
    "() => trajectory.inspectCall?.(request.owner.callId)",
    "() => trajectory.inspectCall?.(otherId)",
  ],
  [
    "missing capability",
    "...(loadMessageImage ? { loadImage: loadMessageImage } : {}),",
    "",
  ],
  [
    "wrong dispatch owner",
    'renderSlot("tool.call.toolview", owner, {',
    'renderSlot("tool.call.toolview", request.owner, {',
  ],
  [
    "wrong wire name",
    "entryKey: request.owner.toolName,",
    "entryKey: request.owner.callId,",
  ],
  [
    "lost semantic fallback",
    "fallback: renderOfficialToolFallback(owner, request.fallback),",
    "fallback: request.fallback,",
  ],
  [
    "lost native fallback",
    "renderOfficialToolFallback(owner, request.fallback)",
    "renderOfficialToolFallback(owner, null)",
  ],
  [
    "later options override",
    "entryKey: request.owner.toolName,",
    "entryKey: request.owner.toolName, ...otherOptions,",
  ],
  [
    "duplicate fallback",
    "fallback: renderOfficialToolFallback(owner, request.fallback),",
    "fallback: renderOfficialToolFallback(owner, request.fallback), fallback: null,",
  ],
];
for (const [name, before, after] of mutations) {
  test(`rejects ${name} even with valid source in a comment`, () => {
    assert.ok(source.includes(before), `mutation anchor missing: ${name}`);
    const changed = source.replace(before, after);
    assert.notEqual(changed, source);
    // A valid-looking implementation in comments must not rescue invalid code.
    const commentedOriginal = source.replaceAll("*/", "* /");
    assert.throws(
      () =>
        verifyToolDispatchContract(`${changed}\n/* ${commentedOriginal} */`),
      /Tool dispatch contract:/,
    );
  });
}
