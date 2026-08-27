import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const chatStyles = readFileSync(resolve(here, "../chat.css"), "utf8");

const tabRailBlock =
  chatStyles.match(/\.amiba-tab-rail[\s\S]*?(?=\n\/\*)/)?.[0] ?? "";

describe("tab rail scrollbar", () => {
  it("renders the rail's scrollbar as a hairline indicator", () => {
    expect(tabRailBlock).toMatch(
      /\.amiba-tab-rail::-webkit-scrollbar\s*\{[^}]*height:\s*3px/,
    );
    expect(tabRailBlock).toMatch(
      /\.amiba-tab-rail::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px/,
    );
  });

  it("never sets scrollbar-width on the rail", () => {
    // Chromium ignores EVERY ::-webkit-scrollbar rule as soon as
    // `scrollbar-width` is anything but `auto`, and its own `thin` is ~11px.
    // Adding the property here silently restores the thick bar, so the
    // hairline above only holds while this stays absent.
    expect(tabRailBlock).not.toMatch(/scrollbar-width/);
  });
});
