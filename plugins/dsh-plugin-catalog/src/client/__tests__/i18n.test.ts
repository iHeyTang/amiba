import { describe, expect, it } from "vitest";

import { catalogI18n } from "../i18n.js";

// The catalog dict already enforces parity at the type level (`zhCN` is a
// `Record<CatalogMessageKey, string>`), but the exported overlay is the
// type-erased `PluginCatalogOverlay`; this runtime guard keeps parity
// observable in the same shape as the other plugins' dicts (M2b review
// follow-up).
describe("catalogI18n", () => {
  it("has identical key sets for en and zh-CN", () => {
    expect(Object.keys(catalogI18n["zh-CN"]).sort()).toEqual(
      Object.keys(catalogI18n.en).sort(),
    );
  });
});
