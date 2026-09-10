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
 * can fail with, not just the ones this manual-only wizard is likely to hit:
 * plugin-owned copy is the doctrine, and a provider body must be able to
 * translate every failure its own submit path can produce without reaching
 * into another plugin's catalog. The five lifecycle codes are duplicated with
 * connector-core on purpose — core keeps them for its own row-mutation path
 * (enable/disable/remove/owners), which this wizard never drives.
 */
export const dingtalkI18n: PluginCatalogOverlay = {
  en: {
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
      "Connect a DingTalk Stream Mode robot to Amiba without exposing a public webhook. Add multiple robot accounts when teams, organizations or agent presets need separate identities.",
    "options.connect.dsh.dingtalk.detail.stream.title": "Stream Mode",
    "options.connect.dsh.dingtalk.detail.stream.description":
      "Maintain an official long connection without a public callback address.",
    "options.connect.dsh.dingtalk.detail.messaging.title": "Bot conversations",
    "options.connect.dsh.dingtalk.detail.messaging.description":
      "Receive robot messages and return agent replies to the originating conversation.",
    "options.connect.dsh.dingtalk.detail.approval.title": "Tool approvals",
    "options.connect.dsh.dingtalk.detail.approval.description":
      "Respond to agent tool approvals in the conversation, using the shared approval waiting policy.",
    "options.connect.dsh.dingtalk.detail.tools.title": "Optional tools",
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
      "通过钉钉 Stream Mode 机器人接入 Amiba，无需暴露公网 Webhook。团队、组织或智能体预设需要独立身份时，可以添加多个机器人账号。",
    "options.connect.dsh.dingtalk.detail.stream.title": "Stream Mode",
    "options.connect.dsh.dingtalk.detail.stream.description":
      "使用官方长连接工作，不需要配置公网回调地址。",
    "options.connect.dsh.dingtalk.detail.messaging.title": "机器人会话",
    "options.connect.dsh.dingtalk.detail.messaging.description":
      "接收机器人消息，并把 Agent 回复发送到原会话。",
    "options.connect.dsh.dingtalk.detail.approval.title": "工具审批",
    "options.connect.dsh.dingtalk.detail.approval.description":
      "在会话中确认智能体的工具操作，沿用公共的审批等待策略。",
    "options.connect.dsh.dingtalk.detail.tools.title": "可选工具",
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
