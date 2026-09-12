import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DingtalkWizard`.
 *
 * M2 doctrine: a plugin owns its own strings. These keys were migrated
 * VERBATIM out of `dsh-plugin-connector-core/src/client/i18n.ts` when the
 * per-provider dialog became a registered wizard body — the dingtalk
 * credential labels and the generic verbs this body's own buttons render.
 * Key NAMES are unchanged so the copy a user sees is bit-identical to what
 * the retired dialog showed.
 *
 * That includes all seven `options.connect.dsh.error.*` codes a create call
 * can fail with, not just the ones this wizard is likely to hit:
 * plugin-owned copy is the doctrine, and a provider body must be able to
 * translate every failure its own submit path can produce without reaching
 * into another plugin's catalog. The five lifecycle codes are duplicated with
 * connector-core on purpose — core keeps them for its own row-mutation path
 * (enable/disable/remove/owners), which this wizard never drives.
 */
export const dingtalkI18n: PluginCatalogOverlay = {
  en: {
    "options.connect.dsh.dingtalk.detail.documents.title": "DingTalk documents",
    "options.connect.dsh.dingtalk.detail.documents.description":
      "Ask AI to find a document, summarize it and organize next steps.",
    "options.connect.dsh.dingtalk.detail.onboarding.title":
      "Quick QR connection",
    "options.connect.dsh.dingtalk.detail.onboarding.description":
      "Follow the guided scans to connect your workspace and documents.",
    "options.connect.dsh.dingtalk.subtitleScan":
      "Connect DingTalk to chat with AI and let it find and summarize your documents.",
    "options.connect.dsh.dingtalk.subtitleManual":
      "Enter the robot’s Client ID and Secret.",
    "options.connect.dsh.dingtalk.scan.title": "Quick connection",
    "options.connect.dsh.onboard.modeScan": "Back to quick connection",
    "options.connect.dsh.onboard.customize": "Connection name and AI assistant",
    "options.connect.dsh.onboard.modeManual": "Advanced: use an existing app",
    "options.connect.dsh.onboard.begin": "Start quick connection",
    "options.connect.dsh.onboard.intro":
      "Scan with DingTalk and follow its prompts. Next, connect your documents and enable the supported AI work abilities in this setup.",
    "options.connect.dsh.onboard.qrAlt": "DingTalk authorization QR code",
    "options.connect.dsh.onboard.waiting": "Preparing authorization…",
    "options.connect.dsh.onboard.note.polling":
      "Complete robot setup in DingTalk. Waiting for authorization…",
    "options.connect.dsh.onboard.note.retrying":
      "Connection interrupted. Retrying…",
    "options.connect.dsh.onboard.error.generic":
      "Quick connection failed. Please retry.",
    "options.connect.dsh.onboard.error.expired":
      "Authorization expired. Start again to get a new QR code.",
    "options.connect.dsh.onboard.error.failed":
      "Authorization failed. Check organization permissions and approval in DingTalk, then retry.",
    "options.connect.dsh.onboard.error.network":
      "Cannot reach DingTalk. Check your connection and retry.",
    "options.connect.dsh.onboard.error.invalid":
      "DingTalk returned an incomplete response. Retry or enter credentials manually.",
    "options.connect.dsh.onboard.error.api":
      "DingTalk could not complete authorization. Retry or enter credentials manually.",

    "options.connect.dsh.dingtalk.title": "Connect DingTalk",
    "options.connect.dsh.dingtalk.subtitle":
      "Enter the robot's Client ID and Secret.",
    "options.connect.dsh.dingtalk.clientId": "Client ID",
    "options.connect.dsh.dingtalk.clientSecret": "Client secret",
    "options.connect.dsh.dingtalk.identity.title": "Connection identity",
    "options.connect.dsh.dingtalk.identity.description":
      "Name this account and choose the agent preset it should use.",
    "options.connect.dsh.dingtalk.credentials.title": "Robot credentials",
    "options.connect.dsh.dingtalk.credentials.description":
      "Copy both values from the DingTalk developer console for this robot.",
    "options.connect.dsh.detail.capabilities": "Capabilities",
    "options.connect.dsh.dingtalk.detail.summary":
      "Bring AI into your DingTalk work: chat with your assistant, find documents and organize information. We will guide you through the connection steps.",
    "options.connect.dsh.dingtalk.detail.stream.title": "Stream Mode",
    "options.connect.dsh.dingtalk.detail.stream.description":
      "Maintain an official long connection without a public callback address.",
    "options.connect.dsh.dingtalk.detail.messaging.title":
      "Chat with your AI assistant",
    "options.connect.dsh.dingtalk.detail.messaging.description":
      "Receive robot messages and return agent replies to the originating conversation.",
    "options.connect.dsh.dingtalk.detail.approval.title":
      "Confirm important actions",
    "options.connect.dsh.dingtalk.detail.approval.description":
      "Respond to agent tool approvals in the conversation, using the shared approval waiting policy.",
    "options.connect.dsh.dingtalk.detail.tools.title":
      "Find and work with your information",
    "options.connect.dsh.dingtalk.detail.tools.description":
      "Optionally provision contacts, calendar and task tools for the connected agent.",
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
    "options.connect.dsh.cancel": "Cancel",
    "options.connect.dsh.close": "Close",
    "options.connect.dsh.submit": "Add",
    "options.connect.dsh.loading": "Loading…",
  },
  "zh-CN": {
    "options.connect.dsh.dingtalk.detail.documents.title": "钉钉文档",
    "options.connect.dsh.dingtalk.detail.documents.description":
      "直接让 AI 找到相关文档、总结重点、整理待办。",
    "options.connect.dsh.dingtalk.detail.onboarding.title": "扫码快速连接",
    "options.connect.dsh.dingtalk.detail.onboarding.description":
      "跟着页面扫码，完成工作区和资料的连接。",
    "options.connect.dsh.dingtalk.subtitleScan":
      "连接钉钉，和 AI 对话，让它帮你查文档、整理资料。",
    "options.connect.dsh.dingtalk.subtitleManual":
      "填写机器人的 Client ID 与 Secret。",
    "options.connect.dsh.dingtalk.scan.title": "快速连接",
    "options.connect.dsh.onboard.modeScan": "返回快速连接",
    "options.connect.dsh.onboard.customize": "连接名称与 AI 助手",
    "options.connect.dsh.onboard.modeManual": "高级设置：使用已有应用",
    "options.connect.dsh.onboard.begin": "开始快速连接",
    "options.connect.dsh.onboard.intro":
      "用钉钉扫码，按提示确认。接着在这里连接工作资料，将一并开通此连接支持的资料查阅和工作操作。",
    "options.connect.dsh.onboard.qrAlt": "钉钉授权二维码",
    "options.connect.dsh.onboard.waiting": "正在生成授权二维码…",
    "options.connect.dsh.onboard.note.polling":
      "请在钉钉中完成机器人配置，正在等待授权结果…",
    "options.connect.dsh.onboard.note.retrying": "网络暂时中断，正在重试…",
    "options.connect.dsh.onboard.error.generic": "快速连接失败，请重试。",
    "options.connect.dsh.onboard.error.expired":
      "授权已过期，请重新开始获取二维码。",
    "options.connect.dsh.onboard.error.failed":
      "授权失败，请在钉钉中检查组织权限和审批状态后重试。",
    "options.connect.dsh.onboard.error.network":
      "暂时无法连接钉钉，请检查网络后重试。",
    "options.connect.dsh.onboard.error.invalid":
      "钉钉返回的信息不完整，请重试或手动填写凭证。",
    "options.connect.dsh.onboard.error.api":
      "钉钉暂时无法完成授权，请重试或手动填写凭证。",

    "options.connect.dsh.dingtalk.title": "接入钉钉",
    "options.connect.dsh.dingtalk.subtitle":
      "填写机器人的 Client ID 与 Secret。",
    "options.connect.dsh.dingtalk.clientId": "Client ID",
    "options.connect.dsh.dingtalk.clientSecret": "Client Secret",
    "options.connect.dsh.dingtalk.identity.title": "连接身份",
    "options.connect.dsh.dingtalk.identity.description":
      "为这个账号命名，并选择它使用的智能体预设。",
    "options.connect.dsh.dingtalk.credentials.title": "机器人凭证",
    "options.connect.dsh.dingtalk.credentials.description":
      "从钉钉开发者后台复制该机器人的两项凭证。",
    "options.connect.dsh.detail.capabilities": "可用能力",
    "options.connect.dsh.dingtalk.detail.summary":
      "把 AI 带进你的钉钉工作中：随时对话、查找文档、整理资料。按页面引导完成连接即可。",
    "options.connect.dsh.dingtalk.detail.stream.title": "Stream Mode",
    "options.connect.dsh.dingtalk.detail.stream.description":
      "使用官方长连接工作，不需要配置公网回调地址。",
    "options.connect.dsh.dingtalk.detail.messaging.title":
      "在聊天中随时找 AI 帮忙",
    "options.connect.dsh.dingtalk.detail.messaging.description":
      "接收机器人消息，并把 Agent 回复发送到原会话。",
    "options.connect.dsh.dingtalk.detail.approval.title": "重要操作由你确认",
    "options.connect.dsh.dingtalk.detail.approval.description":
      "在会话中确认智能体的工具操作，沿用公共的审批等待策略。",
    "options.connect.dsh.dingtalk.detail.tools.title": "查找和处理工作资料",
    "options.connect.dsh.dingtalk.detail.tools.description":
      "可选择为 Agent 配置通讯录、日历和任务工具。",
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
    "options.connect.dsh.cancel": "取消",
    "options.connect.dsh.close": "关闭",
    "options.connect.dsh.submit": "添加",
    "options.connect.dsh.loading": "加载中…",
  },
};
