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
    "options.connect.dsh.wizard.changePlatform": "Change platform",
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
    "options.connect.dsh.onboard.modeScan": "Scan to connect",
    "options.connect.dsh.onboard.modeManual": "Manual setup",
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
    "options.connect.dsh.lark.domain": "Domain",
    "options.connect.dsh.wizard.changePlatform": "换个平台",
    "options.connect.dsh.wizard.privacyHint":
      "凭证只保存在本机，不会发送给模型",
    "options.connect.dsh.error.agent_preset_required":
      "创建连接前请先选择 Agent Preset。",
    "options.connect.dsh.error.provider_not_found": "该 Provider 已不再安装。",
    "options.connect.dsh.error.connect_not_found": "该连接已不存在。",
    "options.connect.dsh.error.invalid_channel": "该 Provider 的消息渠道配置无效。",
    "options.connect.dsh.error.grant_not_found": "该连接保存的凭据缺失或已失效。",
    "options.connect.dsh.error.onboarding_not_found": "该扫码会话已过期或不存在。",
    "options.connect.dsh.error.onboarding_unsupported":
      "该 Provider 不支持扫码接入。",
    "options.connect.dsh.onboard.modeScan": "扫码接入",
    "options.connect.dsh.onboard.modeManual": "手动填写",
    "options.connect.dsh.onboard.begin": "开始扫码",
    "options.connect.dsh.onboard.intro": "点击“开始扫码”，生成该 Provider 的登录二维码。",
    "options.connect.dsh.onboard.qrAlt": "接入二维码",
    "options.connect.dsh.onboard.waiting": "正在等待 Provider 响应…",
    "options.connect.dsh.onboard.error.generic": "扫码失败，请重试。",
    "options.connect.dsh.onboard.note.polling": "正在等待扫码…",
    "options.connect.dsh.onboard.note.slow_down": "扫描过于频繁，正在降速…",
    "options.connect.dsh.onboard.note.domain_switched":
      "登录域名已切换，如二维码失效请重新扫码。",
    "options.connect.dsh.cancel": "取消",
    "options.connect.dsh.submit": "添加",
  },
};
