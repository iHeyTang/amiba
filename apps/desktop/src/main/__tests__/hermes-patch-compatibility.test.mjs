import assert from "node:assert/strict";
import test from "node:test";

const { HERMES_PATCH_COMPATIBILITY, classifyHermesPatchCompatibility } =
  await import("../../../scripts/hermes-patch-compatibility.mjs");

test("an unmet contract with an applicable diff still needs the patch", () => {
  assert.equal(
    classifyHermesPatchCompatibility({
      verifierPasses: false,
      patchApplies: true,
    }),
    HERMES_PATCH_COMPATIBILITY.APPLY,
  );
});

test("an already satisfied contract marks the patch for retirement", () => {
  assert.equal(
    classifyHermesPatchCompatibility({
      verifierPasses: true,
      patchApplies: false,
    }),
    HERMES_PATCH_COMPATIBILITY.RETIRE,
  );
});

test("an unmet contract with an incompatible diff reports a conflict", () => {
  assert.equal(
    classifyHermesPatchCompatibility({
      verifierPasses: false,
      patchApplies: false,
    }),
    HERMES_PATCH_COMPATIBILITY.CONFLICT,
  );
});
