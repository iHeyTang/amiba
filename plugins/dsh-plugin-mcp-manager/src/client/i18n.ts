import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshMcpToolsTab`.
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host `en.ts` / `zh-CN.ts` bundles. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` — the overlay is passed
 * to `usePluginT` and its keys take precedence over the host catalog.
 *
 * Every value below was copied verbatim from the host catalogs at
 * migration time (`packages/i18n/src/en.ts` / `zh-CN.ts`). Shared
 * `common.*` vocabulary intentionally stays host-side and is NOT copied.
 */
export const mcpI18n: PluginCatalogOverlay = {
  en: {
    "externalTools.mcp.title": "External tools",
    "externalTools.mcp.add": "Add MCP",
    "externalTools.mcp.emptyTitle": "No MCP services added",
    "externalTools.mcp.dsh.subtitle":
      "Load external tools as native DSH Cordis plugins. DSH currently bridges MCP tools, not resources or prompts.",
    "externalTools.mcp.dsh.emptyDescription":
      "Add a stdio or Streamable HTTP server to register its tools in DSH.",
    "externalTools.mcp.dsh.serverName": "Server namespace",
    "externalTools.mcp.dsh.args": "One argument per line",
    "externalTools.mcp.dsh.cwd": "Working directory (optional)",
    "externalTools.mcp.dsh.env": "Environment JSON (optional)",
    "externalTools.mcp.dsh.headers": "Headers JSON (optional)",
    "externalTools.mcp.dsh.preserveSecrets":
      "Leave blank to preserve configured secrets: {keys}",
    "externalTools.mcp.dsh.hotReload":
      "Saving rewrites the private DSH Cordis patch. Enabled servers hot-reload into the native tool registry.",
    "externalTools.mcp.dsh.saved": "DSH MCP configuration saved",
    "externalTools.mcp.dsh.deleteConfirm": "Remove MCP server “{name}”?",
    "externalTools.status.enabled": "Enabled",
    "externalTools.status.disabled": "Disabled",
  },
  "zh-CN": {
    "externalTools.mcp.title": "外部工具",
    "externalTools.mcp.add": "添加 MCP",
    "externalTools.mcp.emptyTitle": "尚未添加 MCP",
    "externalTools.mcp.dsh.subtitle":
      "把外部工具作为 DSH 原生 Cordis plugin 加载。DSH 当前只桥接 MCP Tools，不桥接 Resources 或 Prompts。",
    "externalTools.mcp.dsh.emptyDescription":
      "添加 stdio 或 Streamable HTTP 服务，把它的工具注册到 DSH。",
    "externalTools.mcp.dsh.serverName": "服务命名空间",
    "externalTools.mcp.dsh.args": "每行一个参数",
    "externalTools.mcp.dsh.cwd": "工作目录（可选）",
    "externalTools.mcp.dsh.env": "环境变量 JSON（可选）",
    "externalTools.mcp.dsh.headers": "请求头 JSON（可选）",
    "externalTools.mcp.dsh.preserveSecrets":
      "留空以保留已配置的秘密字段：{keys}",
    "externalTools.mcp.dsh.hotReload":
      "保存后会重写私有 DSH Cordis patch；已启用服务会热重载到原生工具注册表。",
    "externalTools.mcp.dsh.saved": "已保存 DSH MCP 配置",
    "externalTools.mcp.dsh.deleteConfirm": "确定移除 MCP 服务“{name}”吗？",
    "externalTools.status.enabled": "已启用",
    "externalTools.status.disabled": "已停用",
  },
};
