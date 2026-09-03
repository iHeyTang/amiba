import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshSettingsConnect`.
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host catalogs. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` (and connector-core's
 * sibling `plugins/dsh-plugin-messaging-core/src/client/i18n.ts`) — the
 * overlay is passed to `usePluginT` and its keys take precedence over the
 * host catalog.
 *
 * Unlike `DshSettingsMessaging`, this page keeps even the generic verbs
 * (cancel/add/confirm/loading) in its own overlay instead of the shared
 * `common.*` host vocabulary: this page's tests exercise those buttons
 * directly (the add-connect trigger, remove confirm/cancel), and `common.*`
 * only resolves through a host locale runtime that isolated component
 * tests do not install — plugin-local keeps the copy real and testable
 * without that dependency.
 *
 * Provider-wizard copy is NOT here: a provider plugin owns its own overlay
 * (see `dsh-plugin-connector-lark/src/client/i18n.ts`), so the keys the
 * retired per-provider dialog used — the submit verb, the credential privacy
 * hint, the platform-picker heading and the `Provider` column label — live
 * there now and were dropped from this catalog.
 */
export const connectI18n: PluginCatalogOverlay = {
  en: {
    "options.connect.dsh.description":
      "Bind messaging platforms to DSH sessions through connector provider plugins. Each connect owns one agent preset and, once configured, its own messaging channel.",
    "options.connect.dsh.add": "Add connect",
    "options.connect.dsh.addDescription":
      "Bind a platform provider to an agent preset. Provide the credentials that provider needs to authenticate.",
    "options.connect.dsh.noProviders":
      "Install a platform plugin (for example Lark) to add a connect.",
    "options.connect.dsh.empty": "No connects yet",
    "options.connect.dsh.emptyDescription":
      "Add a connect to bind a messaging platform to an agent preset.",
    "options.connect.dsh.wizard.pickSubtitle":
      "Choose the platform to connect; that platform's wizard takes over from here.",
    "options.connect.dsh.wizard.noPlatformHint":
      "Missing a platform? Install its connector plugin and it appears here.",
    "options.connect.dsh.wizard.changePlatform": "Change platform",
    "options.connect.dsh.wizard.noWizard":
      "This platform has no setup wizard installed.",
    "options.connect.dsh.name": "Connect name",
    "options.connect.dsh.agentPreset": "Agent preset",
    "options.connect.dsh.status.ready": "Ready",
    "options.connect.dsh.status.connecting": "Connecting",
    "options.connect.dsh.status.error": "Error: {detail}",
    "options.connect.dsh.status.off": "Off",
    "options.connect.dsh.status.degraded": "Degraded: {detail}",
    "options.connect.dsh.enable": "Turn on",
    "options.connect.dsh.disable": "Turn off",
    "options.connect.dsh.remove": "Remove",
    "options.connect.dsh.confirmRemove":
      "Remove this connect? This cannot be undone.",
    "options.connect.dsh.confirmRemoveAction": "Confirm removal",
    "options.connect.dsh.cancel": "Cancel",
    "options.connect.dsh.loading": "Loading…",
    "options.connect.dsh.owners": "{count} owners",
    "options.connect.dsh.pairingExplanation":
      "While this connect is pairing, the first sender to message it is automatically added as an owner.",
    "options.connect.dsh.ownersAddPlaceholder": "Add owner id",
    "options.connect.dsh.ownersAdd": "Add",
    "options.connect.dsh.ownersRemove": "Remove {owner}",
    "options.connect.dsh.ownersEmpty": "No owners yet",
    "options.connect.dsh.error.agent_preset_required":
      "Choose an agent preset before creating this connect.",
    "options.connect.dsh.error.provider_not_found":
      "That provider is no longer installed.",
    "options.connect.dsh.error.connect_not_found":
      "That connect no longer exists.",
    "options.connect.dsh.error.invalid_channel":
      "This provider's messaging channel configuration is invalid.",
    "options.connect.dsh.error.grant_not_found":
      "This connect's stored credentials are missing or invalid.",
    "options.connect.dsh.error.onboarding_not_found":
      "This onboarding session has expired or no longer exists.",
    "options.connect.dsh.error.onboarding_unsupported":
      "That provider doesn't support scan-to-connect onboarding.",
    "options.connect.dsh.tool.action": "Connect platform",
    "options.connect.dsh.tool.waiting": "Waiting for you to finish below…",
    "options.connect.dsh.tool.connected": "Connected {provider} · {name}",
    "options.connect.dsh.tool.cancelled": "Cancelled",
    "options.connect.dsh.tool.failed": "Failed",
  },
  "zh-CN": {
    "options.connect.dsh.description":
      "通过连接器 Provider 插件，把消息平台绑定到 DSH 会话。每个连接都绑定一个 Agent Preset，配置完成后会拥有自己的消息渠道。",
    "options.connect.dsh.add": "添加连接",
    "options.connect.dsh.addDescription":
      "把一个平台 Provider 绑定到某个 Agent Preset，并提供该 Provider 认证所需的凭据。",
    "options.connect.dsh.noProviders": "请先安装平台插件（例如 Lark）后再添加连接。",
    "options.connect.dsh.empty": "尚未配置连接",
    "options.connect.dsh.emptyDescription":
      "添加一个连接，把消息平台绑定到某个 Agent Preset。",
    "options.connect.dsh.wizard.pickSubtitle":
      "选择要接入的平台，接下来由该平台的接入向导接管。",
    "options.connect.dsh.wizard.noPlatformHint":
      "没有你要的平台？安装对应的连接器插件后会出现在这里。",
    "options.connect.dsh.wizard.changePlatform": "换个平台",
    "options.connect.dsh.wizard.noWizard": "该平台暂无接入向导",
    "options.connect.dsh.name": "连接名称",
    "options.connect.dsh.agentPreset": "Agent Preset",
    "options.connect.dsh.status.ready": "就绪",
    "options.connect.dsh.status.connecting": "连接中",
    "options.connect.dsh.status.error": "错误：{detail}",
    "options.connect.dsh.status.off": "已关闭",
    "options.connect.dsh.status.degraded": "降级：{detail}",
    "options.connect.dsh.enable": "启用",
    "options.connect.dsh.disable": "停用",
    "options.connect.dsh.remove": "移除",
    "options.connect.dsh.confirmRemove": "确认移除此连接？该操作无法撤销。",
    "options.connect.dsh.confirmRemoveAction": "确认移除",
    "options.connect.dsh.cancel": "取消",
    "options.connect.dsh.loading": "加载中…",
    "options.connect.dsh.owners": "{count} 位所有者",
    "options.connect.dsh.pairingExplanation":
      "该连接处于配对状态时，第一个发消息的人会被自动添加为所有者。",
    "options.connect.dsh.ownersAddPlaceholder": "添加所有者 ID",
    "options.connect.dsh.ownersAdd": "添加",
    "options.connect.dsh.ownersRemove": "移除 {owner}",
    "options.connect.dsh.ownersEmpty": "暂无所有者",
    "options.connect.dsh.error.agent_preset_required":
      "创建连接前请先选择 Agent Preset。",
    "options.connect.dsh.error.provider_not_found": "该 Provider 已不再安装。",
    "options.connect.dsh.error.connect_not_found": "该连接已不存在。",
    "options.connect.dsh.error.invalid_channel": "该 Provider 的消息渠道配置无效。",
    "options.connect.dsh.error.grant_not_found": "该连接保存的凭据缺失或已失效。",
    "options.connect.dsh.error.onboarding_not_found": "该扫码会话已过期或不存在。",
    "options.connect.dsh.error.onboarding_unsupported":
      "该 Provider 不支持扫码接入。",
    "options.connect.dsh.tool.action": "接入平台",
    "options.connect.dsh.tool.waiting": "等待你在下方完成接入…",
    "options.connect.dsh.tool.connected": "已接入 {provider} · {name}",
    "options.connect.dsh.tool.cancelled": "已取消",
    "options.connect.dsh.tool.failed": "失败",
  },
};
