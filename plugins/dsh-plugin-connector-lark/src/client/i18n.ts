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
      "Connect Feishu to chat with AI and let it find and summarize your documents.",
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
      "Bring AI into your Feishu work: chat with your assistant, find documents and organize information. We will guide you through the connection steps.",
    "options.connect.dsh.lark.detail.messaging.title":
      "Chat with your AI assistant",
    "options.connect.dsh.lark.detail.messaging.description":
      "Receive messages in real time and return agent replies to the same chat.",
    "options.connect.dsh.lark.detail.onboarding.title": "Quick QR setup",
    "options.connect.dsh.lark.detail.onboarding.description":
      "Follow the guided scans to connect your workspace and documents.",
    "options.connect.dsh.lark.detail.approval.title":
      "Confirm important actions",
    "options.connect.dsh.lark.detail.approval.description":
      "Present tool approvals as interactive cards and update the result in place.",
    "options.connect.dsh.lark.detail.tools.title":
      "Find and work with your information",
    "options.connect.dsh.lark.detail.tools.description":
      "Find documents and people, and work with information your workspace allows AI to access.",
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
    "options.connect.dsh.onboard.customize": "Connection name and AI assistant",
    "options.connect.dsh.onboard.modeManual": "Advanced: use an existing app",
    "options.connect.dsh.onboard.begin": "Start scanning",
    "options.connect.dsh.onboard.intro":
      "Scan with Feishu and follow its prompts. Next, connect your documents and enable the supported AI work abilities in this setup.",
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
      "连接飞书，和 AI 对话，让它帮你查文档、整理资料。",
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
      "把 AI 带进你的飞书工作中：随时对话、查找文档、整理资料。按页面引导完成连接即可。",
    "options.connect.dsh.lark.detail.messaging.title": "在聊天中随时找 AI 帮忙",
    "options.connect.dsh.lark.detail.messaging.description":
      "实时接收消息，并把 Agent 的回复发回原会话。",
    "options.connect.dsh.lark.detail.onboarding.title": "扫码快速接入",
    "options.connect.dsh.lark.detail.onboarding.description":
      "跟着页面扫码，完成工作区和资料的连接。",
    "options.connect.dsh.lark.detail.approval.title": "重要操作由你确认",
    "options.connect.dsh.lark.detail.approval.description":
      "在会话中展示交互式审批卡片，并原位更新处理结果。",
    "options.connect.dsh.lark.detail.tools.title": "查找和处理工作资料",
    "options.connect.dsh.lark.detail.tools.description":
      "查找文档和联系人，处理工作区允许 AI 访问的信息。",
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
    "options.connect.dsh.onboard.customize": "连接名称与 AI 助手",
    "options.connect.dsh.onboard.modeManual": "高级设置：使用已有应用",
    "options.connect.dsh.onboard.begin": "开始扫码",
    "options.connect.dsh.onboard.intro":
      "用飞书扫码，按提示确认。接着在这里连接工作资料，将一并开通此连接支持的资料查阅和工作操作。",
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
