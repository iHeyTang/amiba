import type { ITheme } from "@xterm/xterm";

type ResolvedTheme = "light" | "dark";

/**
 * xterm does not accept every color format that Chromium accepts. In
 * particular, alpha-channel HSL foreground colors are rejected and silently
 * fall back to xterm's default white foreground. Keep this palette in the
 * explicit hex/rgba formats xterm supports and define all ANSI colors so a
 * light terminal never renders white-on-white output.
 */
export function workspaceTerminalTheme(theme: ResolvedTheme): ITheme {
  if (theme === "dark") {
    return {
      background: "#09090b",
      foreground: "#e4e4e7",
      cursor: "#e4e4e7",
      cursorAccent: "#09090b",
      selectionBackground: "rgba(228, 228, 231, 0.18)",
      selectionInactiveBackground: "rgba(228, 228, 231, 0.1)",
      black: "#27272a",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#facc15",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#d4d4d8",
      brightBlack: "#71717a",
      brightRed: "#fca5a5",
      brightGreen: "#86efac",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#fafafa",
    };
  }

  return {
    background: "#ffffff",
    foreground: "#24292f",
    cursor: "#24292f",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(36, 41, 47, 0.16)",
    selectionInactiveBackground: "rgba(36, 41, 47, 0.09)",
    black: "#24292f",
    red: "#cf222e",
    green: "#1a7f37",
    yellow: "#9a6700",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    // ANSI white means palette slot 7, not the terminal canvas color. It
    // must remain visible against a light background.
    white: "#57606a",
    brightBlack: "#6e7781",
    brightRed: "#a40e26",
    brightGreen: "#116329",
    brightYellow: "#7d4e00",
    brightBlue: "#0550ae",
    brightMagenta: "#6639ba",
    brightCyan: "#096b72",
    brightWhite: "#24292f",
  };
}
