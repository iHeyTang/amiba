import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { dependencyDirectories, contains } from "./dsh-client-dependencies.mjs";

test("workspace invalidation includes transitive dependencies and terminates on cycles", () => {
  const packages = new Map([
    [
      "a",
      { directory: "/a", manifest: { dependencies: { b: "workspace:*" } } },
    ],
    ["b", { directory: "/b", manifest: { peerDependencies: { c: "*" } } }],
    [
      "c",
      {
        directory: "/c",
        manifest: { optionalDependencies: { a: "*", missing: "*" } },
      },
    ],
  ]);
  assert.deepEqual(dependencyDirectories("a", packages), ["/a", "/b", "/c"]);
});

test("invalidation respects path boundaries", () => {
  const root = path.resolve("/workspace/plugins/a");
  assert.equal(contains(root, path.join(root, "src/new.ts")), true);
  assert.equal(contains(root, root + "-other/src/new.ts"), false);
  assert.equal(contains(root, path.join(root, "../b/src/new.ts")), false);
});
