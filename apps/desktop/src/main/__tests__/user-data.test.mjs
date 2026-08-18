import assert from "node:assert/strict";
import test from "node:test";

const { resolveUserDataOverride } = await import("../user-data.ts");

test("accepts only an explicit absolute Amiba user-data directory", () => {
  assert.equal(resolveUserDataOverride(undefined), null);
  assert.equal(resolveUserDataOverride("  "), null);
  assert.equal(
    resolveUserDataOverride(" /tmp/amiba-dsh-fresh/user-data/../user-data "),
    "/tmp/amiba-dsh-fresh/user-data",
  );
  assert.throws(() => resolveUserDataOverride("relative/user-data"), /absolute/);
});
