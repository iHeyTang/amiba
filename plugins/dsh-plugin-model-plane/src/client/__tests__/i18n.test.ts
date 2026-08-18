import { describe, expect, it } from "vitest";

import { modelPlaneI18n } from "../i18n.js";

// `PluginCatalogOverlay` types both languages as plain string records, so
// the compiler cannot notice a key that exists in one language but not the
// other (M2b review follow-up). This guard makes that drift a test failure.
describe("modelPlaneI18n", () => {
  it("has identical key sets for en and zh-CN", () => {
    expect(Object.keys(modelPlaneI18n["zh-CN"]).sort()).toEqual(
      Object.keys(modelPlaneI18n.en).sort(),
    );
  });
});
