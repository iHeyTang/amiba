import { describe, expect, it } from "vitest";

import { usageToolsI18n } from "../i18n.js";

// `PluginCatalogOverlay` types both languages as plain string records, so
// the compiler cannot notice a key that exists in one language but not the
// other (M2b review follow-up). This guard makes that drift a test failure.
describe("usageToolsI18n", () => {
  it("has identical key sets for en and zh-CN", () => {
    expect(Object.keys(usageToolsI18n["zh-CN"]).sort()).toEqual(
      Object.keys(usageToolsI18n.en).sort(),
    );
  });
});
