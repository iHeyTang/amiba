import { describe, expect, it } from "vitest";

import {
  APP_SIDEBAR_DEFAULT_WIDTH,
  APP_SIDEBAR_MAX_WIDTH,
  APP_SIDEBAR_MIN_WIDTH,
  clampAppSidebarWidth,
  snapAppSidebarWidth,
} from "./sidebar-layout";

describe("app sidebar geometry", () => {
  it("clamps widths to the supported range", () => {
    expect(clampAppSidebarWidth(100)).toBe(APP_SIDEBAR_MIN_WIDTH);
    expect(clampAppSidebarWidth(500)).toBe(APP_SIDEBAR_MAX_WIDTH);
  });

  it("snaps widths near the shared default", () => {
    expect(snapAppSidebarWidth(228)).toBe(APP_SIDEBAR_DEFAULT_WIDTH);
    expect(snapAppSidebarWidth(251)).toBe(APP_SIDEBAR_DEFAULT_WIDTH);
    expect(snapAppSidebarWidth(227)).toBe(227);
    expect(snapAppSidebarWidth(253)).toBe(253);
  });
});
