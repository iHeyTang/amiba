import { describe, expect, it } from "vitest";

import {
  createPluginTranslator,
  resolvePluginTemplate,
  type PluginCatalogOverlay,
} from "./plugin";

const overlay: PluginCatalogOverlay = {
  en: {
    "options.example.title": "Example plugin",
    "options.example.greeting": "Hello, {name}!",
    "options.example.enOnly": "Only in English",
  },
  "zh-CN": {
    "options.example.title": "示例插件",
    "options.example.greeting": "你好，{name}！",
  },
};

describe("resolvePluginTemplate", () => {
  it("prefers the overlay over the host catalog for the active language", () => {
    // "common.cancel" exists in both the host catalog and (for this test)
    // a plugin overlay — the overlay must win.
    const withOverride: PluginCatalogOverlay = {
      en: { "common.cancel": "Never mind" },
      "zh-CN": { "common.cancel": "算了" },
    };
    expect(resolvePluginTemplate("common.cancel", "en", withOverride)).toBe(
      "Never mind",
    );
    expect(
      resolvePluginTemplate("common.cancel", "zh-CN", withOverride),
    ).toBe("算了");
  });

  it("falls back to the host catalog when the key is absent from the overlay", () => {
    expect(resolvePluginTemplate("common.cancel", "en", overlay)).toBe(
      "Cancel",
    );
    expect(resolvePluginTemplate("common.cancel", "zh-CN", overlay)).toBe(
      "取消",
    );
  });

  it("falls back to the host catalog identically when no overlay is given at all", () => {
    expect(resolvePluginTemplate("common.cancel", "en")).toBe("Cancel");
    expect(resolvePluginTemplate("common.cancel", "zh-CN")).toBe("取消");
  });

  it("falls back to the overlay's English entry when the active language is missing it", () => {
    // "options.example.enOnly" only exists in overlay.en, not overlay["zh-CN"],
    // and it is not a host key at all.
    expect(
      resolvePluginTemplate("options.example.enOnly", "zh-CN", overlay),
    ).toBe("Only in English");
  });

  it("returns the raw key when it exists nowhere (overlay, host, or host English)", () => {
    expect(
      resolvePluginTemplate("options.example.doesNotExist", "en", overlay),
    ).toBe("options.example.doesNotExist");
    expect(
      resolvePluginTemplate("options.example.doesNotExist", "en"),
    ).toBe("options.example.doesNotExist");
  });

  it("matches today's missing-key behavior (raw key, not empty string) with no overlay", () => {
    expect(resolvePluginTemplate("totally.unknown.key", "zh-CN")).toBe(
      "totally.unknown.key",
    );
  });
});

describe("createPluginTranslator", () => {
  it("interpolates {param} placeholders from overlay templates", () => {
    const t = createPluginTranslator("en", overlay);
    expect(t("options.example.greeting", { name: "Ada" })).toBe(
      "Hello, Ada!",
    );

    const tZh = createPluginTranslator("zh-CN", overlay);
    expect(tZh("options.example.greeting", { name: "Ada" })).toBe(
      "你好，Ada！",
    );
  });

  it("interpolates {param} placeholders from host templates identically to before", () => {
    const t = createPluginTranslator("en");
    expect(t("workspacePane.filesChanged", { count: 3 })).toBe(
      "3 files changed",
    );
  });

  it("leaves an unmatched placeholder untouched, same as the host t()", () => {
    const t = createPluginTranslator("en", overlay);
    expect(t("options.example.greeting", {})).toBe("Hello, {name}!");
    expect(t("options.example.greeting")).toBe("Hello, {name}!");
  });

  it("overlay precedence and interpolation compose together", () => {
    const withOverride: PluginCatalogOverlay = {
      en: { "workspacePane.filesChanged": "{count} plugin file(s)" },
      "zh-CN": { "workspacePane.filesChanged": "{count} 个插件文件" },
    };
    const t = createPluginTranslator("en", withOverride);
    expect(t("workspacePane.filesChanged", { count: 2 })).toBe(
      "2 plugin file(s)",
    );
  });

  it("returns the key unchanged (post-interpolation no-op) for a fully missing key", () => {
    const t = createPluginTranslator("en", overlay);
    expect(t("options.example.doesNotExist")).toBe(
      "options.example.doesNotExist",
    );
  });
});
