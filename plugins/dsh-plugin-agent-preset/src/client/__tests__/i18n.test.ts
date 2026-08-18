import { describe, expect, it } from "vitest";

import { agentPresetI18n } from "../i18n.js";

// `PluginCatalogOverlay` types both languages as plain string records, so
// the compiler cannot notice a key that exists in one language but not the
// other. This guard makes that drift a test failure (skills/model-plane
// precedent).
describe("agentPresetI18n", () => {
  it("has identical key sets for en and zh-CN", () => {
    expect(Object.keys(agentPresetI18n["zh-CN"]).sort()).toEqual(
      Object.keys(agentPresetI18n.en).sort(),
    );
  });
});
