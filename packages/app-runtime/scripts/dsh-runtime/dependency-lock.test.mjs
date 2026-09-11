import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateDependencyLock } from "./dependency-lock.mjs";

const manifest = { private: true, dependencies: { example: "1.0.0" }, overrides: {} };
const lock = { lockfileVersion: 3, packages: {
  "": { dependencies: { example: "1.0.0" } },
  "node_modules/example": { version: "1.0.0", resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz" },
} };

test("accepts a portable lock and equivalent manifests regardless of key order", () => {
  validateDependencyLock(manifest, { overrides: {}, dependencies: { example: "1.0.0" }, private: true }, lock);
});
test("dependency and override changes require explicit lock refresh", () => {
  for (const changed of [
    { ...manifest, dependencies: { example: "2.0.0" } },
    { ...manifest, overrides: { example: "2.0.0" } },
  ]) assert.throws(() => validateDependencyLock(changed, manifest, lock), /runtime:lock/);
  assert.throws(() => validateDependencyLock(manifest, manifest, { ...lock, packages: { "": { dependencies: {} } } }), /runtime:lock/);
});
test("cannot distribute lockfiles captured as local workspace links", () => {
  for (const entry of [{ link: true, resolved: "../workspace" }, { resolved: "file:/Users/test/package" }, { extraneous: true }]) {
    assert.throws(() => validateDependencyLock(manifest, manifest, { ...lock, packages: { ...lock.packages, "node_modules/local": entry } }), /non-distributable/);
  }
});

test("committed distribution lock retains native dependencies for all platforms", () => {
  const recorded = JSON.parse(readFileSync(new URL("../../runtime-deps/package.json", import.meta.url), "utf8"));
  const committed = JSON.parse(readFileSync(new URL("../../runtime-deps/package-lock.json", import.meta.url), "utf8"));
  validateDependencyLock(recorded, recorded, committed);
  const packages = committed.packages;
  function resolves(location, name) {
    for (;;) {
      if (packages[`${location ? location + "/" : ""}node_modules/${name}`]) return true;
      if (!location) return false;
      const index = location.lastIndexOf("/node_modules/");
      location = index < 0 ? "" : location.slice(0, index);
    }
  }
  for (const [location, entry] of Object.entries(packages)) {
    for (const name of Object.keys(entry.optionalDependencies ?? {})) {
      assert.ok(resolves(location, name), `${location} is missing optional dependency ${name}`);
    }
  }
});
