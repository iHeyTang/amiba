import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for the agent-preset management UI.
 *
 * M2 doctrine: the plugin owns its own `options.agents.*` strings instead of
 * depending on the host catalogs. Every value below was
 * copied verbatim from the host catalogs at migration time, and the host
 * copies were purged in the same commits — the management-UI keys with the
 * AP move, the behavior-editor family (`role.*`, `soul.*`, `loadFailed`,
 * `soulLoadFailed`, `saveFailed`, `section.behavior`) with the AP2 move of
 * the 行为与人设 settings page (AP3 then folded that page into the roster as
 * the pinned default-preset row, so the behavior-editor keys now render
 * inside the drill-in only). This dictionary is now the only owner of the
 * whole `options.agents.*` family (enforced by verify-pluginization's
 * agent-preset-ui module). `common.*` stays host-side by convention.
 */
export const agentPresetI18n: PluginCatalogOverlay = {
  en: {
    "options.agents.defaultShort": "Default",
    "options.agents.setActive": "Make default task preset",
    "options.agents.create": "New agent preset",
    "options.agents.rename": "Rename agent preset",
    "options.agents.name": "Preset name",
    "options.agents.startFrom": "Start from",
    "options.agents.fresh": "Current default preset",
    "options.agents.displayName": "Display name",
    "options.agents.displayNamePlaceholder": "For example: Researcher",
    "options.agents.noDescription": "No description",
    "options.agents.customEmptyTitle": "No other agent presets",
    "options.agents.customEmptyDescription":
      "The default preset above carries the standard configuration. Create an agent here when it needs its own behavior, skills, tools, or memory.",
    "options.agents.cloneDefault": "Amiba",
    "options.agents.section.behavior": "Behavior & identity",
    "options.agents.role.title": "Description",
    "options.agents.role.description":
      "A short description shown when choosing who should run a task.",
    "options.agents.role.placeholder":
      "For example: investigates sources and verifies claims.",
    "options.agents.soul.title": "Behavior and principles",
    "options.agents.soul.description":
      "Durable identity, working principles, and expression owned by this DSH Agent Preset.",
    "options.agents.soul.placeholder":
      "Describe how this agent should think, work, and communicate…",
    "options.agents.deleteConfirm": "Delete “{name}” and its preset data?",
    "options.agents.loadFailed": "Couldn't load agent presets",
    "options.agents.soulLoadFailed": "Couldn't load SOUL.md",
    "options.agents.saveFailed": "Couldn't save the preset",
    "options.agents.activateFailed": "Couldn't change the default preset",
    "options.agents.createFailed": "Couldn't create the preset",
    "options.agents.renameFailed": "Couldn't rename the preset",
    "options.agents.deleteFailed": "Couldn't delete the preset",
  },
  "zh-CN": {
    "options.agents.defaultShort": "默认",
    "options.agents.setActive": "设为默认任务预设",
    "options.agents.create": "新建智能体预设",
    "options.agents.rename": "重命名智能体预设",
    "options.agents.name": "预设名称",
    "options.agents.startFrom": "创建方式",
    "options.agents.fresh": "当前默认预设",
    "options.agents.displayName": "显示名称",
    "options.agents.displayNamePlaceholder": "例如：资料研究员",
    "options.agents.noDescription": "未添加描述",
    "options.agents.customEmptyTitle": "暂无其他智能体预设",
    "options.agents.customEmptyDescription":
      "上方的默认预设承载默认配置；在这里新建需要独立行为、技能、工具或记忆的智能体。",
    "options.agents.cloneDefault": "Amiba",
    "options.agents.section.behavior": "行为与人设",
    "options.agents.role.title": "描述",
    "options.agents.role.description":
      "用一句话说明它擅长什么；选择任务执行者时会展示。",
    "options.agents.role.placeholder": "例如：负责资料检索与事实核验。",
    "options.agents.soul.title": "行为与准则",
    "options.agents.soul.description":
      "由这个 DSH 智能体预设统一拥有的长期身份、原则、工作方式与表达风格。",
    "options.agents.soul.placeholder": "描述这个智能体应该如何思考、工作与沟通…",
    "options.agents.deleteConfirm": "删除「{name}」及其预设数据？",
    "options.agents.loadFailed": "无法加载智能体预设",
    "options.agents.soulLoadFailed": "无法加载 SOUL.md",
    "options.agents.saveFailed": "无法保存预设",
    "options.agents.activateFailed": "无法切换默认预设",
    "options.agents.createFailed": "无法新建预设",
    "options.agents.renameFailed": "无法重命名预设",
    "options.agents.deleteFailed": "无法删除预设",
  },
};
