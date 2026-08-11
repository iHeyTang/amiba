import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { HERMES_LOCAL_MODE, loadDesktopLocalConfig, parseDesktopLocalConfig } =
  await import("../../../scripts/desktop-local-config.mjs");

test("desktop local config defaults to the built-in Runtime", () => {
  assert.deepEqual(parseDesktopLocalConfig(undefined, "/repo"), {
    hermesMode: HERMES_LOCAL_MODE.BUILT_IN,
  });
  assert.deepEqual(
    parseDesktopLocalConfig({ hermes: { mode: "built-in" } }, "/repo"),
    { hermesMode: HERMES_LOCAL_MODE.BUILT_IN },
  );
});

test("desktop local config resolves a direct Hermes source from the repository root", () => {
  assert.deepEqual(
    parseDesktopLocalConfig(
      {
        hermes: {
          mode: "direct-source",
          source: "../hermes-agent",
        },
      },
      "/work/amiba",
    ),
    {
      hermesMode: HERMES_LOCAL_MODE.DIRECT_SOURCE,
      hermesSource: "/work/hermes-agent",
    },
  );
});

test("desktop local config rejects incomplete or unknown direct-source modes", () => {
  assert.throws(
    () =>
      parseDesktopLocalConfig({ hermes: { mode: "direct-source" } }, "/repo"),
    /hermes\.source/,
  );
  assert.throws(
    () => parseDesktopLocalConfig({ hermes: { mode: "unknown" } }, "/repo"),
    /hermes\.mode/,
  );
  assert.throws(
    () =>
      parseDesktopLocalConfig(
        { hermes: { mode: "built-in", unexpected: true } },
        "/repo",
      ),
    /unknown hermes property/,
  );
});

test("the checked-in TypeScript example loads with the runtime parser", async () => {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../..",
  );
  assert.equal(
    (
      await loadDesktopLocalConfig(
        path.join(repositoryRoot, ".amiba.local.example.ts"),
        repositoryRoot,
      )
    ).hermesMode,
    HERMES_LOCAL_MODE.DIRECT_SOURCE,
  );
});
