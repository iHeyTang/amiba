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
 * Deliberately NOT migrated: connector-core's other `error.*` codes
 * (`agent_preset_required`, `provider_not_found`, `invalid_channel`,
 * `grant_not_found`). Those belong to the connect lifecycle that core still
 * owns and renders; a create failure carrying one of them surfaces its raw
 * message here rather than duplicating core's copy into every provider.
 */
export const larkI18n: PluginCatalogOverlay = {
  en: {
    "options.connect.dsh.lark.appId": "App ID",
    "options.connect.dsh.lark.appSecret": "App secret",
    "options.connect.dsh.lark.domain": "Domain",
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
    "options.connect.dsh.onboard.scanInstructions":
      "Scan this QR code with the platform's app to authorize Amiba.",
    "options.connect.dsh.onboard.longConnectionHint":
      "If this connect doesn't come online after scanning, open the Feishu open-platform console for this app and set Event Subscription to long-connection mode — that setting can't be configured automatically and needs a manual switch. Keep Amiba running while it connects.",
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
    "options.connect.dsh.loading": "Loading…",
  },
  "zh-CN": {
    "options.connect.dsh.lark.appId": "App ID",
    "options.connect.dsh.lark.appSecret": "App Secret",
    "options.connect.dsh.lark.domain": "Domain",
    "options.connect.dsh.error.onboarding_not_found": "该扫码会话已过期或不存在。",
    "options.connect.dsh.error.onboarding_unsupported":
      "该 Provider 不支持扫码接入。",
    "options.connect.dsh.onboard.modeScan": "扫码接入",
    "options.connect.dsh.onboard.modeManual": "手动填写",
    "options.connect.dsh.onboard.begin": "开始扫码",
    "options.connect.dsh.onboard.intro": "点击“开始扫码”，生成该 Provider 的登录二维码。",
    "options.connect.dsh.onboard.qrAlt": "接入二维码",
    "options.connect.dsh.onboard.scanInstructions":
      "使用该平台的 App 扫描此二维码以授权 Amiba。",
    "options.connect.dsh.onboard.longConnectionHint":
      "如果扫码后连接迟迟未能上线，请前往飞书开放平台该应用的设置，将“事件订阅”的接收方式改为“使用长连接接收事件”——该设置无法自动配置，需要手动切换。扫码期间请保持 Amiba 处于运行状态。",
    "options.connect.dsh.onboard.waiting": "正在等待 Provider 响应…",
    "options.connect.dsh.onboard.error.generic": "扫码失败，请重试。",
    "options.connect.dsh.onboard.note.polling": "正在等待扫码…",
    "options.connect.dsh.onboard.note.slow_down": "扫描过于频繁，正在降速…",
    "options.connect.dsh.onboard.note.domain_switched":
      "登录域名已切换，如二维码失效请重新扫码。",
    "options.connect.dsh.cancel": "取消",
    "options.connect.dsh.submit": "添加",
    "options.connect.dsh.loading": "加载中…",
  },
};
