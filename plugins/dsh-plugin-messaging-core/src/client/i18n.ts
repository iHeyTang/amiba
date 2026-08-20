import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshSettingsMessaging`.
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host catalogs. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` — the overlay is passed
 * to `usePluginT` and its keys take precedence over the host catalog.
 *
 * Every value below was copied verbatim from the host catalogs at
 * migration time (the host catalogs). Shared
 * `common.*` vocabulary intentionally stays host-side and is NOT copied.
 * `options.status.dsh.runtime` is duplicated here because this settings
 * pane reuses that label for its runtime-details disclosure; the host
 * Status page keeps its own copy.
 */
export const messagingI18n: PluginCatalogOverlay = {
  en: {
    "options.messaging.dsh.description":
      "Route authenticated external messages into DSH sessions through channel-provider plugins.",
    "options.messaging.dsh.add": "Add channel",
    "options.messaging.dsh.pluginTitle": "DSH messaging-core plugin",
    "options.messaging.dsh.pluginDescription":
      "The core owns authentication, deduplication, session routing, retries, and reply correlation. Transport plugins only implement their channel protocol.",
    "options.messaging.dsh.channels": "Configured channels",
    "options.messaging.dsh.channelsDescription":
      "Each channel targets one durable DSH session.",
    "options.messaging.dsh.group.configured": "Configured",
    "options.messaging.dsh.group.configuredDescription":
      "Routes already connected to a DSH conversation.",
    "options.messaging.dsh.group.available": "Available channels",
    "options.messaging.dsh.group.availableDescription":
      "Set up another route from an installed transport provider.",
    "options.messaging.dsh.summary.connected":
      "{connected} of {total} channels active",
    "options.messaging.dsh.summary.none": "No message channels are active",
    "options.messaging.dsh.providerCount": "{count} transport providers",
    "options.messaging.dsh.search": "Search channels",
    "options.messaging.dsh.searchEmpty": "No channels match this search.",
    "options.messaging.dsh.manage": "Manage",
    "options.messaging.dsh.setup": "Set up",
    "options.messaging.dsh.needsSetup": "Needs setup",
    "options.messaging.dsh.configure": "Set up {name}",
    "options.messaging.dsh.disable": "Turn off",
    "options.messaging.dsh.enable": "Turn on",
    "options.messaging.dsh.saveChanges": "Save changes",
    "options.messaging.dsh.empty": "No DSH channels yet",
    "options.messaging.dsh.emptyDescription":
      "Create a webhook channel now; additional transports can register as independent DSH plugins.",
    "options.messaging.dsh.inboundEndpoint": "Inbound endpoint",
    "options.messaging.dsh.loopbackHint":
      "This endpoint is loopback-only. Put an authenticated reverse proxy or tunnel in front of it when an external service must reach this device.",
    "options.messaging.dsh.rotate": "Rotate secret",
    "options.messaging.dsh.createDescription":
      "Bind a transport provider to one existing DSH session.",
    "options.messaging.dsh.provider": "Provider",
    "options.messaging.dsh.name": "Channel name",
    "options.messaging.dsh.session": "Target session",
    "options.messaging.dsh.selectSession": "Select a session",
    "options.messaging.dsh.outboundUrl": "Reply callback URL (optional)",
    "options.messaging.dsh.allowedSenders":
      "Allowed sender IDs (optional, comma-separated)",
    "options.messaging.dsh.secretTitle": "Channel secret",
    "options.messaging.dsh.secretDescription":
      "This bearer secret is shown only once. Store it now; rotating it immediately invalidates the previous value.",
    "options.messaging.dsh.pending": "{count} awaiting DSH",
    "options.messaging.dsh.queued": "{count} replies queued",
    "options.messaging.dsh.failed": "{count} replies need attention",
    "options.messaging.status.connected": "Connected",
    "options.messaging.status.disabled": "Off",
    "options.status.dsh.runtime": "Managed runtime",
  },
  "zh-CN": {
    "options.messaging.dsh.description":
      "通过渠道 Provider 插件，将已认证的外部消息路由到 DSH 会话。",
    "options.messaging.dsh.add": "添加渠道",
    "options.messaging.dsh.pluginTitle": "DSH 消息中心插件",
    "options.messaging.dsh.pluginDescription":
      "核心统一负责认证、去重、会话路由、重试与回复关联；每个传输插件只实现自己的渠道协议。",
    "options.messaging.dsh.channels": "已配置渠道",
    "options.messaging.dsh.channelsDescription":
      "每个渠道绑定一个持久化 DSH 会话。",
    "options.messaging.dsh.group.configured": "已配置",
    "options.messaging.dsh.group.configuredDescription":
      "已经连接到 DSH 会话的渠道路由。",
    "options.messaging.dsh.group.available": "其他渠道",
    "options.messaging.dsh.group.availableDescription":
      "从已安装的传输 Provider 新建一条渠道路由。",
    "options.messaging.dsh.summary.connected":
      "已启用 {connected} / {total} 个渠道",
    "options.messaging.dsh.summary.none": "当前没有启用消息渠道",
    "options.messaging.dsh.providerCount": "{count} 个传输 Provider",
    "options.messaging.dsh.search": "搜索渠道",
    "options.messaging.dsh.searchEmpty": "没有匹配的渠道。",
    "options.messaging.dsh.manage": "管理",
    "options.messaging.dsh.setup": "设置",
    "options.messaging.dsh.needsSetup": "需要设置",
    "options.messaging.dsh.configure": "设置 {name}",
    "options.messaging.dsh.disable": "停用",
    "options.messaging.dsh.enable": "启用",
    "options.messaging.dsh.saveChanges": "保存更改",
    "options.messaging.dsh.empty": "尚未配置 DSH 渠道",
    "options.messaging.dsh.emptyDescription":
      "现在可以创建 Webhook 渠道；其他传输方式可作为独立 DSH 插件注册。",
    "options.messaging.dsh.inboundEndpoint": "入站地址",
    "options.messaging.dsh.loopbackHint":
      "该地址仅监听本机。外部服务需要访问时，请在前面部署带认证的反向代理或安全隧道。",
    "options.messaging.dsh.rotate": "轮换密钥",
    "options.messaging.dsh.createDescription":
      "把一个传输 Provider 绑定到现有 DSH 会话。",
    "options.messaging.dsh.provider": "Provider",
    "options.messaging.dsh.name": "渠道名称",
    "options.messaging.dsh.session": "目标会话",
    "options.messaging.dsh.selectSession": "选择会话",
    "options.messaging.dsh.outboundUrl": "回复回调地址（选填）",
    "options.messaging.dsh.allowedSenders":
      "允许的发送方 ID（选填，逗号分隔）",
    "options.messaging.dsh.secretTitle": "渠道密钥",
    "options.messaging.dsh.secretDescription":
      "Bearer 密钥只显示一次，请现在妥善保存；轮换后旧密钥会立即失效。",
    "options.messaging.dsh.pending": "{count} 条等待 DSH 处理",
    "options.messaging.dsh.queued": "{count} 条回复待发送",
    "options.messaging.dsh.failed": "{count} 条回复需要处理",
    "options.messaging.status.connected": "已连接",
    "options.messaging.status.disabled": "未启用",
    "options.status.dsh.runtime": "受管运行时",
  },
};
