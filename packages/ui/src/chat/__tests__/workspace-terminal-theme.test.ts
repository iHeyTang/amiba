import { describe, expect, it } from "vitest";

import { workspaceTerminalTheme } from "../workspace-terminal-theme";

const OPAQUE_HEX = /^#[0-9a-f]{6}$/i;

describe("workspaceTerminalTheme", () => {
  it.each(["light", "dark"] as const)(
    "uses xterm-supported, visible colors in %s mode",
    (mode) => {
      const theme = workspaceTerminalTheme(mode);

      expect(theme.foreground).toMatch(OPAQUE_HEX);
      expect(theme.background).toMatch(OPAQUE_HEX);
      expect(theme.cursor).toMatch(OPAQUE_HEX);
      expect(theme.foreground).not.toBe(theme.background);
      expect(theme.cursor).not.toBe(theme.background);
      expect(theme.white).not.toBe(theme.background);
      expect(theme.brightWhite).not.toBe(theme.background);
      expect(theme.selectionBackground).toMatch(/^rgba\(/);
      expect(theme.selectionInactiveBackground).toMatch(/^rgba\(/);
    },
  );

  it("does not pass unsupported alpha HSL colors to xterm", () => {
    for (const mode of ["light", "dark"] as const) {
      const colors = Object.values(workspaceTerminalTheme(mode));
      expect(colors.some((color) => color?.startsWith("hsl("))).toBe(false);
    }
  });
});
