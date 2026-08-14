import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const chatStyles = readFileSync(resolve(here, "../chat.css"), "utf8");

describe("composer fade boundary", () => {
  it("limits horizontal fade expansion to space inside the chat column", () => {
    expect(chatStyles).toMatch(
      /\.amiba-composer-dock::before[\s\S]*?inset-inline:\s*clamp\(-4rem,\s*calc\(\(48rem - 100cqw\) \/ 2\),\s*0rem\)/,
    );
  });
});
