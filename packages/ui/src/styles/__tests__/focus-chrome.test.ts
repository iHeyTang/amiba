import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sharedTokens = readFileSync(resolve(here, "../tokens.css"), "utf8");
const formControl = readFileSync(
  resolve(here, "../../primitives/form-control.ts"),
  "utf8",
);

describe("product focus chrome", () => {
  it("suppresses browser outlines and Tailwind ring halos globally", () => {
    expect(sharedTokens).toMatch(
      /:where\(\*\):focus,[\s\S]*?:where\(\*\):focus-visible\s*\{[\s\S]*?outline:\s*none\s*!important[\s\S]*?--tw-ring-offset-shadow:\s*0 0 #0000\s*!important[\s\S]*?--tw-ring-shadow:\s*0 0 #0000\s*!important/,
    );
  });

  it("does not replace the halo with a focus-only form border", () => {
    expect(formControl).not.toContain("focus-visible:border-");
    expect(formControl).toContain("focus-visible:bg-background");
  });
});
