import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sharedTokens = readFileSync(resolve(here, "../tokens.css"), "utf8");
const presetTokens = readFileSync(
  resolve(here, "../../../../tailwind-preset/styles/tokens.css"),
  "utf8",
);

describe("desktop selection policy", () => {
  it("keeps the shared UI and Tailwind preset policies in sync", () => {
    for (const css of [sharedTokens, presetTokens]) {
      expect(css).toContain("user-select: none");
      expect(css).toContain('[data-selection="text"]');
      expect(css).toContain('[contenteditable="true"]');
      expect(css).toContain("user-select: text");
    }
  });

  it("protects controls nested inside selectable content", () => {
    for (const css of [sharedTokens, presetTokens]) {
      expect(css).toMatch(
        /:where\(\s*button,[\s\S]*?\[role="button"\][\s\S]*?user-select: none/,
      );
    }
  });
});
