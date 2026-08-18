import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const configPath = path.resolve(__dirname, "../tailwind.config.cjs");

/**
 * The shell injects its compiled stylesheet at the end of <head>, after the
 * host app's own Tailwind build. Any utility the shared UI uses but this
 * config fails to scan (e.g. `pl-9` on search inputs) silently loses the
 * cascade to a same-specificity utility that IS present (e.g. `px-3`).
 * A content glob whose base directory does not exist matches nothing and
 * causes exactly that, so every glob must point at a real directory.
 */
describe("ui-shell tailwind content globs", () => {
  const config = require(configPath) as { content: string[] };

  it("declares only globs whose static base directory exists", () => {
    const dead = config.content.filter((glob) => {
      const abs = path.isAbsolute(glob)
        ? glob
        : path.resolve(path.dirname(configPath), glob);
      const segments = abs.split(path.sep);
      const magic = segments.findIndex((s) => /[*{]/.test(s));
      const base = segments.slice(0, magic === -1 ? undefined : magic).join(path.sep);
      return !existsSync(base);
    });
    expect(dead).toEqual([]);
  });

  /**
   * The injected sheet must be a SUPERSET of the utilities used anywhere a
   * host app also ships its own Tailwind build (today: the desktop renderer).
   * Both builds share the same preset, so when every competing class exists
   * in both sheets they resolve identically and the injected sheet can never
   * flip a cascade — coverage gaps are the only way it breaks styling.
   */
  it.each([
    ["shared @amiba/ui package", "../../../packages/ui/src"],
    ["desktop renderer", "../../../apps/desktop/src/renderer"],
  ])("scans the %s sources", (_label, relative) => {
    const sourceDir = path.resolve(configPath, relative);
    expect(existsSync(sourceDir)).toBe(true);
    const covered = config.content.some((glob) => {
      const abs = path.resolve(path.dirname(configPath), glob);
      return abs.startsWith(sourceDir + path.sep) || abs.startsWith(sourceDir);
    });
    expect(covered).toBe(true);
  });
});
