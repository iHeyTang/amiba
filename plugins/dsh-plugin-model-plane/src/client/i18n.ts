import { providerFieldMessages } from "./provider-field-presentation.js";
import { reasoningLabels } from "./reasoning-labels.js";
import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `ModelProviderConfigTab` (the 模型与服务 /
 * "Models & services" settings section).
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host catalogs. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` — the overlay is passed
 * to `usePluginT` and its keys take precedence over the host catalog.
 *
 * Every value below was copied verbatim from the host catalogs at
 * migration time (the host catalogs). Shared
 * `common.*` vocabulary intentionally stays host-side and is NOT copied.
 * `sidepanel.modelPicker.reasoningEffort` is duplicated here because this
 * settings pane reuses that label for its default-model effort selector;
 * the composer model picker keeps its own copy.
 */
export const modelPlaneI18n: PluginCatalogOverlay = {
  en: {
    ...reasoningLabels.en,
    ...providerFieldMessages.en,
    "options.dshModels.availability.unconfigured": "Not configured",
    "options.dshModels.availability.missing-credential": "Key required",
    "options.dshModels.availability.no-models": "No models loaded",
    "options.dshModels.availability.catalog-error": "Model list unavailable",
    "official.keyStored": "Key saved — enter a new key to replace it",
    "official.keyWillRemove": "The saved key will be removed when you save.",
    "official.addRow": "Add model / item",
    "official.inherit": "Use provider default",
    "official.configuration": "Manage API keys and model connection settings.",
    "official.noConfiguration":
      "This plugin provides models but does not declare configuration fields.",
    "official.refreshModels": "Refresh available models",
    "official.refreshed": "Model directory refreshed",

    "options.dshModels.apiKey": "API key",
    "options.dshModels.auth.configured": "Key configured",
    "options.dshModels.auth.missing": "Key required",
    "options.dshModels.auth.native": "Provider auth",
    "options.dshModels.baseURL": "Base URL",
    "options.dshModels.deleteConfirm":
      "Remove this custom endpoint?",
    "options.dshModels.description":
      "Manage provider settings and choose which models appear in your menus.",
    "options.dshModels.displayName": "Display name",
    "options.dshModels.failures": "Model catalog diagnostics",
    "options.dshModels.initialModel": "Initial model",
    "options.dshModels.invalidProviderId":
      "Provider ID must start with a lowercase letter and contain only letters, numbers, _ or -.",
    "options.dshModels.keepCredential": "Leave blank to keep the stored key",
    "options.dshModels.protocol": "API protocol",
    "options.dshModels.providerId": "Provider ID",
    "options.dshModels.requiredProviderFields":
      "Base URL and an initial model are required.",
    "options.models.display.mediaToggle": "Allow calls to {name}",
    "options.models.display.unsupported": "Not supported yet",
    "options.models.config.defaultsTitle": "Model assignments",
    "options.models.config.main": "Default model",
    "options.models.config.mainUnset": "Not set — choose a model",
    "options.models.config.pickerDescription":
      "Search configured providers and assign a model to this task.",
    "options.models.config.pickerTitle": "Choose a model for {task}",
    "options.models.config.searchForTask": "Search models for {task}…",
    "options.models.details.dialogDescription":
      "Extended model information and its available data sources.",
    "options.models.details.openFor": "View details for {name}",
    "options.models.display.availableModels": "{count} models",
    "options.models.display.configureProvider": "Configure {name}",
    "options.models.display.current": "Current",
    "options.models.display.empty": "No matching providers or models.",
    "options.models.display.modelToggle": "Show {name} in model menus",
    "options.models.display.noModels":
      "No models are currently available from this provider.",
    "options.models.display.providerToggle": "Show {name} in model menus",
    "options.models.display.search": "Search providers or models…",
    "options.models.display.title": "Service providers",
    "options.models.provider.addCustom": "Add custom endpoint",
    "options.models.provider.credentialPlaceholder": "Enter access credential",
    "options.models.provider.credentialValue": "Credential",
    "options.models.provider.models": "Available models",
    "options.models.provider.noModels":
      "No models are available yet. Save the required credentials, then refresh this list.",
    "sidepanel.modelPicker.reasoningEffort": "Reasoning effort",
  },
  "zh-CN": {
    ...reasoningLabels["zh-CN"],
    ...providerFieldMessages["zh-CN"],
    "options.dshModels.availability.unconfigured": "未配置",
    "options.dshModels.availability.missing-credential": "需要密钥",
    "options.dshModels.availability.no-models": "尚无模型",
    "options.dshModels.availability.catalog-error": "模型列表加载失败",
    "official.keyStored": "已保存密钥，输入新密钥可替换",
    "official.keyWillRemove": "保存后将移除已存储的密钥。",
    "official.addRow": "添加模型 / 条目",
    "official.inherit": "使用服务商默认值",
    "official.configuration": "管理 API 密钥与模型连接设置。",
    "official.noConfiguration": "此插件提供模型，但未声明可编辑的配置字段。",
    "official.refreshModels": "刷新可用模型",
    "official.refreshed": "模型目录已刷新",

    "options.dshModels.apiKey": "API 密钥",
    "options.dshModels.auth.configured": "密钥已配置",
    "options.dshModels.auth.missing": "需要密钥",
    "options.dshModels.auth.native": "提供方原生认证",
    "options.dshModels.baseURL": "接口地址",
    "options.dshModels.deleteConfirm":
      "移除这个自定义端点吗？",
    "options.dshModels.description":
      "管理服务商配置，以及模型菜单中的显示偏好。",
    "options.dshModels.displayName": "显示名称",
    "options.dshModels.failures": "模型目录诊断",
    "options.dshModels.initialModel": "初始模型",
    "options.dshModels.invalidProviderId":
      "提供方 ID 必须以小写字母开头，且只能包含字母、数字、_ 或 -。",
    "options.dshModels.keepCredential": "留空可保留已存储的密钥",
    "options.dshModels.protocol": "接口协议",
    "options.dshModels.providerId": "提供方 ID",
    "options.dshModels.requiredProviderFields": "接口地址和初始模型不能为空。",
    "options.models.display.mediaToggle": "允许调用 {name}",
    "options.models.display.unsupported": "尚未适配",
    "options.models.config.defaultsTitle": "模型分配",
    "options.models.config.main": "默认模型",
    "options.models.config.mainUnset": "尚未设置，请选择模型",
    "options.models.config.pickerDescription":
      "从已配置的服务商中搜索并分配模型。",
    "options.models.config.pickerTitle": "为{task}选择模型",
    "options.models.config.searchForTask": "搜索适用于{task}的模型…",
    "options.models.details.dialogDescription":
      "模型扩展信息及其可用数据来源。",
    "options.models.details.openFor": "查看{name}的详情",
    "options.models.display.availableModels": "{count} 个模型",
    "options.models.display.configureProvider": "配置 {name}",
    "options.models.display.current": "当前使用",
    "options.models.display.empty": "没有匹配的供应商或模型。",
    "options.models.display.modelToggle": "在模型菜单中显示 {name}",
    "options.models.display.noModels": "这个供应商目前没有可用模型。",
    "options.models.display.providerToggle": "在模型菜单中显示 {name}",
    "options.models.display.search": "搜索供应商或模型…",
    "options.models.display.title": "服务提供商",
    "options.models.provider.addCustom": "添加自定义服务",
    "options.models.provider.credentialPlaceholder": "输入访问凭证",
    "options.models.provider.credentialValue": "凭证",
    "options.models.provider.models": "可用模型",
    "options.models.provider.noModels":
      "目前没有可用模型。保存所需凭证后，再刷新此列表。",
    "sidepanel.modelPicker.reasoningEffort": "推理强度",
  },
};
