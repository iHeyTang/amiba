{
  "$schema": "https://raw.githubusercontent.com/iHeyTang/hermes-x/main/packages/extension-api/src/manifest.schema.json",
  "id": "{{ID}}",
  "name": "{{NAME}}",
  "version": "0.1.0",
  "engines": { "hermes-x": "^0.1.0" },
  "entries": { "main": "dist/main.cjs" },
  "contributes": {
    "activityBar": [
      { "id": "main", "icon": "book-open", "labels": { "en": "{{NAME}}", "zh-CN": "{{NAME}}" }, "order": 200 }
    ],
    "sidebarViews": [
      { "id": "main", "anchor": "activityBar:main", "view": "dist/ui/sidebar/index.html" }
    ],
    "settingsTabs": [
      { "id": "main", "labels": { "en": "{{NAME}}", "zh-CN": "{{NAME}}" }, "icon": "book-open", "view": "dist/ui/settings/index.html", "order": 200 }
    ]
  },
  "permissions": ["ipc", "settings", "i18n"]
}
