import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

it("preserves native overlay scrolling instead of forcing classic scrollbar dimensions", () => {
  const styles = ["../tokens.css", "../chat.css"]
    .map(path => readFileSync(resolve(here, path), "utf8"))
    .join("\n");
  expect(styles).not.toMatch(/::-webkit-scrollbar\s*\{[^}]*(?:width|height):/);
  expect(styles).toMatch(/scrollbar-width:\s*thin/);
});
