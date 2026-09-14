import { describe, expect, it } from "vitest";
import { fitWorkspaceWidth, preferredWorkspaceWidth } from "../workspace-pane-layout";

describe("workspace width budget", () => {
  it("keeps a preference above the former fixed maximum", () => {
    expect(preferredWorkspaceWidth(1600)).toBe(1600);
    expect(fitWorkspaceWidth(1600, 2400)).toBe(1600);
  });
  it("reserves the conversation minimum within the measured row, excluding the sidebar", () => {
    expect(fitWorkspaceWidth(2000, 1500)).toBe(1180);
    expect(fitWorkspaceWidth(2000, 1000)).toBe(680);
  });
  it("fits small containers without overflowing", () => {
    expect(fitWorkspaceWidth(520, 600)).toBe(300);
    expect(fitWorkspaceWidth(520, 0)).toBe(0);
  });
});
