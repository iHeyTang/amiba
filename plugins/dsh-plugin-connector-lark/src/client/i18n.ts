import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `LarkWizard`.
 *
 * M2 doctrine: a plugin owns its own strings. These keys were migrated
 * VERBATIM out of `dsh-plugin-connector-core/src/client/i18n.ts` when the
 * per-provider dialog became a registered wizard body — the lark credential
 * labels, the whole scan-onboarding vocabulary (including the `note.*` tokens
 * a lark `onboard()` run emits), the two onboarding failure codes, and the
 * generic verbs this body's own buttons render. Key NAMES are unchanged so the
 * copy a user sees is bit-identical to what the retired dialog showed.
 *
 * That includes all seven `options.connect.dsh.error.*` codes a create or
 * onboarding call can fail with, not just the two onboarding-specific ones:
 * plugin-owned copy is the doctrine, and a provider body must be able to
 * translate every failure its own submit path can produce without reaching
 * into another plugin's catalog. The five lifecycle codes are duplicated with
 * connector-core on purpose — core keeps them for its own row-mutation path
 * (enable/disable/remove/owners), which this wizard never drives.
 */
export const larkI18n: PluginCatalogOverlay = {
  en: {
    "options.connect.dsh.lark.title": "Connect Feishu",
    "options.connect.dsh.lark.subtitleScan":
      "Scan with the Feishu app to authorize; the connect is created automatically.",
    "options.connect.dsh.lark.subtitleManual":
      "Copy from Feishu Open Platform → your app → Credentials & Basic Info.",
    "options.connect.dsh.lark.appId": "App ID",
    "options.connect.dsh.lark.appSecret": "App secret",
    "options.connect.dsh.lark.domain": "Domain",
    "options.connect.dsh.lark.domain.feishu": "Feishu (China)",
    "options.connect.dsh.lark.domain.lark": "Lark (Global)",
    "options.connect.dsh.lark.identity.title": "Connection identity",
    "options.connect.dsh.lark.identity.description":
      "Name this account and choose the agent preset it should use.",
    "options.connect.dsh.lark.scan.title": "QR authorization",
    "options.connect.dsh.lark.credentials.title": "App credentials",
    "options.connect.dsh.lark.credentials.description":
      "Choose the app domain, then enter the credentials from the developer console.",
    "options.connect.dsh.detail.capabilities": "Capabilities",
    "options.connect.dsh.lark.detail.summary":
      "Connect a Feishu or Lark bot to Amiba over the official long connection. Each connection is an independent bot account with its own credentials, agent preset and conversation ownership.",
    "options.connect.dsh.lark.detail.messaging.title": "Bot conversations",
    "options.connect.dsh.lark.detail.messaging.description":
      "Receive messages in real time and return agent replies to the same chat.",
    "options.connect.dsh.lark.detail.onboarding.title": "Quick QR setup",
    "options.connect.dsh.lark.detail.onboarding.description":
      "Scan to authorize and connect. Manual app credentials are available as a fallback.",
    "options.connect.dsh.lark.detail.approval.title": "Native approvals",
    "options.connect.dsh.lark.detail.approval.description":
      "Present tool approvals as interactive cards and update the result in place.",
    "options.connect.dsh.lark.detail.tools.title": "Feishu tools and skills",
    "options.connect.dsh.lark.detail.tools.description":
      "Provision the official MCP tools and selected document, wiki, drive and contact skills.",
    "options.connect.dsh.wizard.changePlatform": "Back to connectors",
    "options.connect.dsh.wizard.privacyHint":
      "Credentials stay on this device and are never sent to the model",
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
    "options.connect.dsh.onboard.modeScan": "Back to scanning",
    "options.connect.dsh.onboard.modeManual": "Set up manually instead",
    "options.connect.dsh.onboard.begin": "Start scanning",
    "options.connect.dsh.onboard.intro":
      "Start scanning to generate a QR code for this provider.",
    "options.connect.dsh.onboard.qrAlt": "Onboarding QR code",
    "options.connect.dsh.onboard.waiting": "Waiting for the provider…",
    "options.connect.dsh.onboard.error.generic":
      "Scanning failed. Please try again.",
    "options.connect.dsh.onboard.note.polling": "Waiting for you to scan…",
    "options.connect.dsh.onboard.note.slow_down":
      "Scanning too fast — slowing down…",
    "options.connect.dsh.onboard.note.domain_switched":
      "Switched login domain — scan again if the code doesn't work.",
    "options.connect.dsh.cancel": "Cancel",
    "options.connect.dsh.close": "Close",
    "options.connect.dsh.submit": "Add",
  },
  "zh-CN": {
    "options.connect.dsh.lark.title": "接入飞书",
    "options.connect.dsh.lark.subtitleScan":
      "用飞书 App 扫码授权，完成后自动创建连接。",
    "options.connect.dsh.lark.subtitleManual":
      "在飞书开放平台 → 你的应用 → 凭证与基础信息 里复制。",
    "options.connect.dsh.lark.appId": "App ID",
    "options.connect.dsh.lark.appSecret": "App Secret",
    "options.connect.dsh.lark.domain": "服务区域",
    "options.connect.dsh.lark.domain.feishu": "飞书（中国）",
    "options.connect.dsh.lark.domain.lark": "Lark（国际）",
    "options.connect.dsh.lark.identity.title": "连接身份",
    "options.connect.dsh.lark.identity.description":
      "为这个账号命名，并选择它使用的智能体预设。",
    "options.connect.dsh.lark.scan.title": "扫码授权",
    "options.connect.dsh.lark.credentials.title": "应用凭证",
    "options.connect.dsh.lark.credentials.description":
      "选择应用所属域名，再填写开发者后台中的应用凭证。",
    "options.connect.dsh.detail.capabilities": "可用能力",
    "options.connect.dsh.lark.detail.summary":
      "通过官方长连接把飞书或 Lark 机器人接入 Amiba。每个连接都是独立的机器人账号，分别保存凭据、智能体预设与会话所有者。",
    "options.connect.dsh.lark.detail.messaging.title": "机器人会话",
    "options.connect.dsh.lark.detail.messaging.description":
      "实时接收消息，并把 Agent 的回复发回原会话。",
    "options.connect.dsh.lark.detail.onboarding.title": "扫码快速接入",
    "options.connect.dsh.lark.detail.onboarding.description":
      "扫码授权即可完成连接；无法扫码时，可手动填写应用凭证。",
    "options.connect.dsh.lark.detail.approval.title": "原生审批",
    "options.connect.dsh.lark.detail.approval.description":
      "在会话中展示交互式审批卡片，并原位更新处理结果。",
    "options.connect.dsh.lark.detail.tools.title": "飞书工具与技能",
    "options.connect.dsh.lark.detail.tools.description":
      "配置官方 MCP 工具，以及文档、知识库、云盘和通讯录等精选技能。",
    "options.connect.dsh.wizard.changePlatform": "返回连接器",
    "options.connect.dsh.wizard.privacyHint":
      "凭证只保存在本机，不会发送给模型",
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
    "options.connect.dsh.onboard.modeScan": "返回扫码",
    "options.connect.dsh.onboard.modeManual": "无法扫码？手动填写",
    "options.connect.dsh.onboard.begin": "开始扫码",
    "options.connect.dsh.onboard.intro": "点击“开始扫码”，生成飞书授权二维码。",
    "options.connect.dsh.onboard.qrAlt": "接入二维码",
    "options.connect.dsh.onboard.waiting": "正在生成授权二维码…",
    "options.connect.dsh.onboard.error.generic": "扫码失败，请重试。",
    "options.connect.dsh.onboard.note.polling": "正在等待扫码…",
    "options.connect.dsh.onboard.note.slow_down": "扫描过于频繁，正在降速…",
    "options.connect.dsh.onboard.note.domain_switched":
      "登录域名已切换，如二维码失效请重新扫码。",
    "options.connect.dsh.cancel": "取消",
    "options.connect.dsh.close": "关闭",
    "options.connect.dsh.submit": "添加",
  },
};
