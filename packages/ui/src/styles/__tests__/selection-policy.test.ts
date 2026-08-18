import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sharedTokens = readFileSync(resolve(here, "../tokens.css"), "utf8");

describe("desktop selection policy", () => {
  it("owns the complete product selection policy", () => {
    expect(sharedTokens).toContain("user-select: none");
    expect(sharedTokens).toContain('[data-selection="text"]');
    expect(sharedTokens).toContain('[contenteditable="true"]');
    expect(sharedTokens).toContain("user-select: text");
  });

  it("protects controls nested inside selectable content", () => {
    expect(sharedTokens).toMatch(
      /:where\(\s*button,[\s\S]*?\[role="button"\][\s\S]*?user-select: none/,
    );
  });
});
