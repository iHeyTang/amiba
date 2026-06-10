{
  "$schema": "https://raw.githubusercontent.com/amiba-desktop/amiba/main/packages/extension-api/src/manifest.schema.json",
  "id": "{{ID}}",
  "name": "{{NAME}}",
  "version": "0.1.0",
  "apiVersion": 1,
  "engines": { "amiba": "^0.1.0" },
  "entries": { "main": "dist/main.cjs" },
  "contributes": {
    "main": {
      "icon": "book-open",
      "labels": { "en": "{{NAME}}", "zh-CN": "{{NAME}}" },
      "view": "dist/ui/main/index.html",
      "order": 200
    },
    "settings": {
      "icon": "book-open",
      "labels": { "en": "{{NAME}}", "zh-CN": "{{NAME}}" },
      "view": "dist/ui/settings/index.html",
      "order": 200
    }
  },
  "permissions": ["ipc", "settings", "i18n"]
}
