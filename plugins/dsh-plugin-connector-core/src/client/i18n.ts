import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/** Connection-owned copy; provider-specific copy stays in each provider plugin. */
export const connectI18n: PluginCatalogOverlay = {
  en: {
    "options.connect.dsh.account.presetHint":
      "Used for new conversations; existing conversations keep their current preset.",
    "options.connect.dsh.account.save": "Save",
    "options.connect.dsh.account.messaging": "Messages and access",
    "options.connect.dsh.account.owners": "Allowed users",
    "options.connect.dsh.account.pairing":
      "The first person to message this connection becomes its owner. Set IDs below to restrict access beforehand.",
    "options.connect.dsh.account.ownersHint":
      "Comma-separated platform user IDs. An empty list blocks all senders.",
    "options.connect.dsh.account.saveOwners": "Save allowed users",
    "options.connect.dsh.account.delivery": "Message delivery",
    "options.connect.dsh.account.pendingInbound": "Processing",
    "options.connect.dsh.account.queuedOutbound": "Awaiting delivery",
    "options.connect.dsh.account.failedOutbound": "Failed",
    "options.connect.dsh.account.conversations": "Conversation routing",
    "options.connect.dsh.account.noConversations":
      "A conversation appears here after the first message.",
    "options.connect.dsh.account.refresh": "Refresh status",
    "options.connect.dsh.account.removeHint":
      "Remove this connection, its credentials and all access approvals for it? Existing conversations are kept.",
    "options.connect.dsh.account.affected": "Approved consumers affected:",
    "options.connect.dsh.account.disableHint": "Turn off this connection? Messaging and dependent tools will stop. Access approvals are kept for when you enable it again.",
    "options.connect.dsh.account.keep": "Keep connection",
    "options.connect.dsh.account.remove": "Remove connection",
    "options.connect.dsh.description":
      "Discover connector providers and add one or more accounts for each. Every account keeps its own credentials, agent preset, and messaging channel.",
    "options.connect.dsh.add": "Add connect",
    "options.connect.dsh.addDescription":
      "Bind a platform provider to an agent preset. Provide the credentials that provider needs to authenticate.",
    "options.connect.dsh.noProviders":
      "Install a connector plugin and it will appear here automatically.",
    "options.connect.dsh.empty": "No connected accounts yet",
    "options.connect.dsh.emptyDescription":
      "Choose a connector above to add your first account.",
    "options.connect.dsh.directory.title": "Connector directory",
    "options.connect.dsh.directory.description":
      "Choose a connector to add an account. You can add the same connector more than once.",
    "options.connect.dsh.directory.search": "Search connectors",
    "options.connect.dsh.directory.filter.label": "Filter connectors",
    "options.connect.dsh.directory.filter.all": "All",
    "options.connect.dsh.directory.filter.connected": "Connected",
    "options.connect.dsh.directory.filter.unconnected": "Not connected",
    "options.connect.dsh.directory.empty": "No connector plugins installed",
    "options.connect.dsh.directory.noResults": "No matching connectors",
    "options.connect.dsh.directory.noResultsDescription":
      "Try another search or filter.",
    "options.connect.dsh.directory.accountCount": "{count} accounts",
    "options.connect.dsh.directory.notConnected": "Not connected",
    "options.connect.dsh.directory.setupUnavailable": "Setup unavailable",
    "options.connect.dsh.directory.addAccount": "Add {provider} account",
    "options.connect.dsh.directory.addAnother":
      "Add another {provider} account",
    "options.connect.dsh.directory.viewDetails": "View {provider} details",
    "options.connect.dsh.detail.back": "Connectors",
    "options.connect.dsh.detail.connected": "{count} connected",
    "options.connect.dsh.detail.agentPreset": "Agent preset · {preset}",
    "options.connect.dsh.detail.noAccounts":
      "No accounts connected yet. Add the first account when you're ready.",
    "options.connect.dsh.detail.security":
      "Only connect platforms and applications you trust. Credentials are stored locally and are not included in model conversations.",
    "options.connect.dsh.accounts.title": "Connected accounts",
    "options.connect.dsh.accounts.description":
      "Each row is an independent account. Accounts from the same connector keep separate credentials and settings.",
    "options.connect.dsh.wizard.pickSubtitle":
      "Choose the platform to connect; that platform's wizard takes over from here.",
    "options.connect.dsh.wizard.noPlatformHint":
      "Missing a platform? Install its connector plugin and it appears here.",
    "options.connect.dsh.wizard.changePlatform": "Back to connectors",
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
    "options.connect.dsh.close": "Close",
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
    "options.connect.dsh.account.presetHint":
      "用于新会话，已有会话继续使用原预设。",
    "options.connect.dsh.account.save": "保存",
    "options.connect.dsh.account.messaging": "消息与访问",
    "options.connect.dsh.account.owners": "允许访问的用户",
    "options.connect.dsh.account.pairing":
      "首位发消息的用户会成为所有者。也可以先在下方指定允许访问的用户。",
    "options.connect.dsh.account.ownersHint":
      "填写平台用户 ID，以逗号分隔。留空将拒绝所有发送者。",
    "options.connect.dsh.account.saveOwners": "保存访问范围",
    "options.connect.dsh.account.delivery": "消息投递",
    "options.connect.dsh.account.pendingInbound": "处理中",
    "options.connect.dsh.account.queuedOutbound": "待投递",
    "options.connect.dsh.account.failedOutbound": "失败",
    "options.connect.dsh.account.conversations": "会话映射",
    "options.connect.dsh.account.noConversations":
      "收到第一条消息后，这里会显示关联的会话。",
    "options.connect.dsh.account.refresh": "刷新状态",
    "options.connect.dsh.account.removeHint":
      "移除此连接、凭证及指向它的全部访问批准？已有会话会保留。",
    "options.connect.dsh.account.affected": "受影响的已授权使用方：",
    "options.connect.dsh.account.disableHint": "停用此连接？消息收发和依赖它的工具会停止。访问批准会保留，重新启用后可恢复。",
    "options.connect.dsh.account.keep": "保留连接",
    "options.connect.dsh.account.remove": "移除连接",
    "options.connect.dsh.description":
      "浏览连接器，并为每个连接器添加一个或多个账号。每个账号都有独立的凭据和智能体预设。",
    "options.connect.dsh.add": "添加连接",
    "options.connect.dsh.addDescription":
      "选择智能体预设，并完成该平台的账号授权。",
    "options.connect.dsh.noProviders": "安装连接器插件后，它会自动出现在这里。",
    "options.connect.dsh.empty": "尚未连接账号",
    "options.connect.dsh.emptyDescription":
      "从上方选择一个连接器，添加第一个账号。",
    "options.connect.dsh.directory.title": "连接器",
    "options.connect.dsh.directory.description":
      "选择连接器来添加账号；同一个连接器可以重复添加多个账号。",
    "options.connect.dsh.directory.search": "搜索连接器",
    "options.connect.dsh.directory.filter.label": "筛选连接器",
    "options.connect.dsh.directory.filter.all": "全部",
    "options.connect.dsh.directory.filter.connected": "已连接",
    "options.connect.dsh.directory.filter.unconnected": "未连接",
    "options.connect.dsh.directory.empty": "尚未安装连接器插件",
    "options.connect.dsh.directory.noResults": "没有匹配的连接器",
    "options.connect.dsh.directory.noResultsDescription":
      "试试其他关键词或筛选条件。",
    "options.connect.dsh.directory.accountCount": "{count} 个账号",
    "options.connect.dsh.directory.notConnected": "尚未连接账号",
    "options.connect.dsh.directory.setupUnavailable": "暂无接入界面",
    "options.connect.dsh.directory.addAccount": "添加 {provider} 账号",
    "options.connect.dsh.directory.addAnother": "继续添加 {provider} 账号",
    "options.connect.dsh.directory.viewDetails": "查看 {provider} 详情",
    "options.connect.dsh.detail.back": "连接器",
    "options.connect.dsh.detail.connected": "已连接 {count} 个账号",
    "options.connect.dsh.detail.agentPreset": "智能体预设 · {preset}",
    "options.connect.dsh.detail.noAccounts":
      "尚未连接账号；准备好后可以从这里添加第一个账号。",
    "options.connect.dsh.detail.security":
      "只连接你信任的平台和应用。凭据保存在本机，不会被写入与模型的会话内容。",
    "options.connect.dsh.accounts.title": "已连接账号",
    "options.connect.dsh.accounts.description":
      "每一项都是独立账号；同一连接器下的多个账号分别保存凭据和设置。",
    "options.connect.dsh.wizard.pickSubtitle":
      "选择要接入的平台，接下来由该平台的接入向导接管。",
    "options.connect.dsh.wizard.noPlatformHint":
      "没有你要的平台？安装对应的连接器插件后会出现在这里。",
    "options.connect.dsh.wizard.changePlatform": "返回连接器",
    "options.connect.dsh.wizard.noWizard": "该平台暂无接入向导",
    "options.connect.dsh.name": "连接名称",
    "options.connect.dsh.agentPreset": "智能体预设",
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
    "options.connect.dsh.close": "关闭",
    "options.connect.dsh.loading": "加载中…",
    "options.connect.dsh.owners": "{count} 位所有者",
    "options.connect.dsh.pairingExplanation":
      "该连接处于配对状态时，第一个发消息的人会被自动添加为所有者。",
    "options.connect.dsh.ownersAddPlaceholder": "添加所有者 ID",
    "options.connect.dsh.ownersAdd": "添加",
    "options.connect.dsh.ownersRemove": "移除 {owner}",
    "options.connect.dsh.ownersEmpty": "暂无所有者",
    "options.connect.dsh.error.agent_preset_required":
      "创建连接前请先选择智能体预设。",
    "options.connect.dsh.error.provider_not_found": "该连接器已卸载。",
    "options.connect.dsh.error.connect_not_found": "该连接已不存在。",
    "options.connect.dsh.error.invalid_channel": "该连接器的消息配置无效。",
    "options.connect.dsh.error.grant_not_found":
      "该连接保存的凭据缺失或已失效。",
    "options.connect.dsh.error.onboarding_not_found":
      "该扫码会话已过期或不存在。",
    "options.connect.dsh.error.onboarding_unsupported":
      "该连接器不支持扫码接入。",
    "options.connect.dsh.tool.action": "接入平台",
    "options.connect.dsh.tool.waiting": "等待你在下方完成接入…",
    "options.connect.dsh.tool.connected": "已接入 {provider} · {name}",
    "options.connect.dsh.tool.cancelled": "已取消",
    "options.connect.dsh.tool.failed": "失败",
  },
};
