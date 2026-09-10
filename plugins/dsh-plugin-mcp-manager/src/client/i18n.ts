import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshMcpToolsTab`.
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host catalogs. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` — the overlay is passed
 * to `usePluginT` and its keys take precedence over the host catalog.
 *
 * Every value below was copied verbatim from the host catalogs at
 * migration time (the host catalogs). Shared
 * `common.*` vocabulary intentionally stays host-side and is NOT copied.
 */
export const mcpI18n: PluginCatalogOverlay = {
  en: {
    "externalTools.mcp.addOptions": "MCP setup options",
    "externalTools.mcp.addChat": "Set up with Agent",
    "externalTools.mcp.addChatHint": "Describe the tools you want to connect",
    "externalTools.mcp.addManual": "Add manually",
    "externalTools.mcp.addManualHint":
      "Enter the service address or local command",
    "externalTools.mcp.creationSeed":
      "Help me connect an MCP service in Amiba. First ask which service or tools I want and whether I have its URL, local command, or setup documentation. Guide me through the required configuration. Use available supported configuration tools if you can save it, then verify the result; otherwise prepare the fields for Settings > MCP > Add manually and explain how to finish. Do not claim it was added without verification. Do not ask me to paste secrets into chat.",
    "externalTools.mcp.dependencies.connection": "Connection",
    "externalTools.mcp.manual": "Added services",
    "externalTools.mcp.manual.description":
      "Connect local or remote MCP services and manage them here.",
    "externalTools.mcp.dependencies.onDemand":
      "Starts when a plugin uses it; no running instance is needed while idle.",
    "externalTools.mcp.dependencies.instances": "instances",
    "externalTools.mcp.dependencies.error": "Startup failed",
    "externalTools.mcp.dependencies.in-use": "In use",
    "externalTools.mcp.dependencies.available": "Starts on demand",
    "externalTools.mcp.dependencies.none": "No plugins using this service",
    "externalTools.mcp.dependencies.consumers": "Used by",
    "externalTools.mcp.dependencies.provider": "Plugin",
    "externalTools.mcp.dependencies.config":
      "Provided and managed by plugins. Tools become available to approved consumers after startup.",
    "externalTools.mcp.dependencies": "Plugin-provided MCP services",
    "externalTools.mcp.title": "MCP services",
    "externalTools.mcp.add": "Add MCP",
    "externalTools.mcp.emptyTitle": "No services added yet",
    "externalTools.mcp.dsh.subtitle":
      "Manage your MCP services and services provided by plugins.",
    "externalTools.mcp.dsh.emptyDescription":
      "Use Add MCP above for Agent-guided setup, or choose Add manually.",
    "externalTools.mcp.dsh.serverName": "Service name",
    "externalTools.mcp.dsh.args": "One argument per line",
    "externalTools.mcp.dsh.cwd": "Working directory (optional)",
    "externalTools.mcp.dsh.env": "Environment JSON (optional)",
    "externalTools.mcp.dsh.headers": "Headers JSON (optional)",
    "externalTools.mcp.dsh.preserveSecrets":
      "Leave blank to preserve configured secrets: {keys}",
    "externalTools.mcp.dsh.hotReload": "Changes take effect after saving.",
    "externalTools.mcp.dsh.saved": "MCP configuration saved",
    "externalTools.mcp.dsh.deleteConfirm": "Remove MCP server “{name}”?",
    "externalTools.status.enabled": "Enabled",
    "externalTools.status.disabled": "Disabled",
  },
  "zh-CN": {
    "externalTools.mcp.addOptions": "MCP 添加方式",
    "externalTools.mcp.addChat": "通过 Agent 引导添加",
    "externalTools.mcp.addChatHint": "描述你想接入的服务或工具",
    "externalTools.mcp.addManual": "手动添加",
    "externalTools.mcp.addManualHint": "自行填写服务地址或本地命令",
    "externalTools.mcp.creationSeed":
      "请帮我在 Amiba 中接入一个 MCP 服务。先询问我想接入什么服务或工具，是否已有服务地址、本地启动命令或接入文档，再引导我补齐必要配置。如果有可用且受支持的配置工具，请完成添加并验证结果；否则整理设置 > MCP > 手动添加所需的字段，指导我完成配置。未经验证不要宣称添加成功，不要让我在聊天中粘贴密钥。",
    "externalTools.mcp.dependencies.connection": "连接",
    "externalTools.mcp.manual": "自行添加的服务",
    "externalTools.mcp.manual.description":
      "自行接入的本地或远程 MCP 服务，可在此编辑和启停。",
    "externalTools.mcp.dependencies.onDemand":
      "插件使用时自动启动，空闲时无需运行实例。",
    "externalTools.mcp.dependencies.instances": "个运行实例",
    "externalTools.mcp.dependencies.error": "启动失败",
    "externalTools.mcp.dependencies.in-use": "使用中",
    "externalTools.mcp.dependencies.available": "按需启动",
    "externalTools.mcp.dependencies.none": "暂无插件使用",
    "externalTools.mcp.dependencies.consumers": "使用方",
    "externalTools.mcp.dependencies.provider": "提供插件",
    "externalTools.mcp.dependencies.config":
      "由插件提供并管理配置；授权并启动后，工具才会向获准的使用方开放。",
    "externalTools.mcp.dependencies": "插件提供的 MCP",
    "externalTools.mcp.title": "MCP 服务",
    "externalTools.mcp.add": "添加 MCP",
    "externalTools.mcp.emptyTitle": "尚未添加服务",
    "externalTools.mcp.dsh.subtitle": "管理自行接入和插件提供的 MCP 工具服务。",
    "externalTools.mcp.dsh.emptyDescription":
      "点击右上角「添加 MCP」，由 Agent 引导接入，也可选择手动添加。",
    "externalTools.mcp.dsh.serverName": "服务名称",
    "externalTools.mcp.dsh.args": "每行一个参数",
    "externalTools.mcp.dsh.cwd": "工作目录（可选）",
    "externalTools.mcp.dsh.env": "环境变量 JSON（可选）",
    "externalTools.mcp.dsh.headers": "请求头 JSON（可选）",
    "externalTools.mcp.dsh.preserveSecrets":
      "留空以保留已配置的秘密字段：{keys}",
    "externalTools.mcp.dsh.hotReload": "保存后配置立即生效。",
    "externalTools.mcp.dsh.saved": "已保存 MCP 配置",
    "externalTools.mcp.dsh.deleteConfirm": "确定移除 MCP 服务“{name}”吗？",
    "externalTools.status.enabled": "已启用",
    "externalTools.status.disabled": "已停用",
  },
};
