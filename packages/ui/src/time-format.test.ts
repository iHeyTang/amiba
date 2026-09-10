import { describe, expect, it } from "vitest";

import {
  defaultTimeFormatPreference,
  formatClockTime,
  normalizeStoredTimeFormat,
} from "./time-format";

describe("time format preference", () => {
  it("uses the active locale when no explicit preference is stored", () => {
    expect(defaultTimeFormatPreference("en-US")).toBe("12h");
    expect(defaultTimeFormatPreference("zh-CN")).toBe("24h");
    expect(normalizeStoredTimeFormat("invalid", "zh-CN")).toBe("24h");
  });

  it("formats the same local time in either selectable clock", () => {
    const timestamp = new Date(2026, 8, 5, 17, 8).getTime();

    expect(formatClockTime(timestamp, "12h", "en-US")?.label).toBe("05:08 PM");
    expect(formatClockTime(timestamp, "24h", "en-US")?.label).toBe("17:08");
  });
});
