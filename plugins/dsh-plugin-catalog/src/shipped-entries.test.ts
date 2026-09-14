import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import { healProfilesModuleFallback } from "@deepseek-ai/dsh-app-boot";
import { expect, it } from "vitest";
import { shippedEntries } from "./registration-source.js";

it.each([false, true])("resolves the runtime from the profile with a direct DSH link: %s", (directLink) => {
  const root = mkdtempSync(join(tmpdir(), "amiba-catalog-"));
  const home = join(root, "home");
  const profile = join(home, "profiles", "catalog-test");
  const runtime = join(root, "runtime", "node_modules");
  const write = (file: string, value: object) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  const bundle = (modules: string, name: string, id: string) => {
    write(join(modules, name, "package.json"), { name, dsh: { bundle: { patch: "./patch.json" } } });
    write(join(modules, name, "patch.json"), [{ insert: [{ id, name: "fixture-plugin" }] }]);
  };
  try {
    const anchor = join(runtime, "@deepseek-ai/dsh/package.json");
    write(anchor, { name: "@deepseek-ai/dsh", dependencies: { "shipped-bundle": "1.0.0" } });
    bundle(runtime, "shipped-bundle", "builtin");
    write(join(profile, "package.json"), { dsh: { profile: { bundles: ["shipped-bundle", "user-bundle"] } } });
    bundle(join(profile, "node_modules"), "shipped-bundle", "shadow");
    bundle(join(profile, "node_modules"), "user-bundle", "user");
    // A broken user patch must not prevent reading the shipped tool inventory.
    writeFileSync(join(profile, "cordis.patch.yml"), "[invalid yaml");
    healProfilesModuleFallback(anchor, home);
    if (directLink) {
      const link = join(profile, "node_modules/@deepseek-ai/dsh");
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(dirname(anchor), link, process.platform === "win32" ? "junction" : "dir");
    }
    const ctx = { root: { baseUrl: pathToFileURL(profile).href + "/" } } as unknown as Context;
    expect([...shippedEntries(ctx, ["shipped-bundle"])]).toEqual([["builtin", "fixture-plugin"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
