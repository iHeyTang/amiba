import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

const tokens = read("../tokens.css");

function layer(name: string): number {
  const match = tokens.match(new RegExp(`--z-${name}:\\s*(\\d+)`));
  if (!match) throw new Error(`missing --z-${name} in tokens.css`);
  return Number(match[1]);
}

/**
 * Every overlay surface in the app, and the layer it must draw from. A modal
 * that picks its own number is how the settings dialog ended up painting over
 * the dialogs opened from inside it.
 */
const SURFACES: Array<[string, string, string]> = [
  ["../../primitives/dialog.tsx", "DialogOverlay", "modal"],
  ["../../primitives/dialog.tsx", "DialogContent", "modal"],
  ["../../settings/SettingsDialog.tsx", "SettingsDialog", "modal"],
  ["../../primitives/select.tsx", "SelectContent", "popover"],
  ["../../primitives/popover.tsx", "PopoverContent", "popover"],
  ["../../primitives/tooltip.tsx", "TooltipContent", "popover"],
  ["../../chat/bubble/chips.tsx", "image viewer close", "modal-chrome"],
];

describe("overlay layering", () => {
  it("orders the scale so nested surfaces can clear their container", () => {
    expect(layer("workbench")).toBeLessThan(layer("app-overlay"));
    expect(layer("app-overlay")).toBeLessThan(layer("shell-overlay"));
    expect(layer("shell-overlay")).toBeLessThan(layer("modal"));
    expect(layer("modal")).toBeLessThan(layer("modal-chrome"));
    // Popovers/selects/tooltips open FROM modals and sit earlier in the DOM,
    // so they cannot rely on paint order and must outrank the modal outright.
    expect(layer("modal-chrome")).toBeLessThan(layer("popover"));
  });

  it("keeps every overlay surface on the shared scale", () => {
    for (const [file, surface, expected] of SURFACES) {
      const source = read(file);
      expect(
        source,
        `${surface} must use z-[var(--z-${expected})]`,
      ).toMatch(new RegExp(`z-\\[var\\(--z-${expected}\\)\\]`));
    }
  });

  it("leaves no hand-picked z-index on an overlay surface", () => {
    // The exact literals that caused the bug: a modal at 50 under a container
    // at 120, and a select at 100 under the same container.
    for (const [file, surface] of SURFACES) {
      expect(read(file), `${surface} still hard-codes a z-index`).not.toMatch(
        /\bz-(50|40|30)\b|\bz-\[\d+\]/,
      );
    }
  });
});
