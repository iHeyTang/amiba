import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const chatStyles = readFileSync(resolve(here, "../chat.css"), "utf8");

describe("composer glass boundary", () => {
  it("does not paint a gradient mask over the window canvas", () => {
    expect(chatStyles).not.toContain(".amiba-composer-dock::before");
  });
});
