{
  "$schema": "https://raw.githubusercontent.com/iHeyTang/hermes-x/main/packages/extension-api/src/manifest.schema.json",
  "id": "{{ID}}",
  "name": "{{NAME}}",
  "version": "0.1.0",
  "engines": { "hermes-x": "^0.1.0" },
  "entries": {
    "main": "dist/main.cjs",
    "renderer": "dist/renderer.js"
  },
  "i18n": {
    "en": "dist/i18n/en.json",
    "zh-CN": "dist/i18n/zh-CN.json"
  },
  "contributes": {
    "activityBar": [
      {
        "id": "main",
        "iconKey": "book-open",
        "labelKey": "activityBar.label",
        "order": 200
      }
    ],
    "sidebarViews": [
      { "id": "main", "anchor": "activityBar:main" }
    ]
  },
  "permissions": ["settings", "i18n"]
}
