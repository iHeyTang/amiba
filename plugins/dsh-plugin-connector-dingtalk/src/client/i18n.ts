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
    "options.connect.dsh.dingtalk.clientId": "Client ID",
    "options.connect.dsh.dingtalk.clientSecret": "Client secret",
    "options.connect.dsh.dingtalk.enableTools": "Enable tools (experimental)",
    "options.connect.dsh.dingtalk.enableToolsHint":
      "Tool access uses DingTalk's official but experimental dingtalk-mcp integration.",
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
    "options.connect.dsh.submit": "Add",
    "options.connect.dsh.loading": "Loading…",
  },
  "zh-CN": {
    "options.connect.dsh.dingtalk.clientId": "Client ID",
    "options.connect.dsh.dingtalk.clientSecret": "Client Secret",
    "options.connect.dsh.dingtalk.enableTools": "启用工具（实验）",
    "options.connect.dsh.dingtalk.enableToolsHint":
      "工具能力基于钉钉官方但仍处于实验阶段的 dingtalk-mcp 集成。",
    "options.connect.dsh.error.agent_preset_required":
      "创建连接前请先选择 Agent Preset。",
    "options.connect.dsh.error.provider_not_found": "该 Provider 已不再安装。",
    "options.connect.dsh.error.connect_not_found": "该连接已不存在。",
    "options.connect.dsh.error.invalid_channel": "该 Provider 的消息渠道配置无效。",
    "options.connect.dsh.error.grant_not_found": "该连接保存的凭据缺失或已失效。",
    "options.connect.dsh.error.onboarding_not_found": "该扫码会话已过期或不存在。",
    "options.connect.dsh.error.onboarding_unsupported":
      "该 Provider 不支持扫码接入。",
    "options.connect.dsh.cancel": "取消",
    "options.connect.dsh.submit": "添加",
    "options.connect.dsh.loading": "加载中…",
  },
};
