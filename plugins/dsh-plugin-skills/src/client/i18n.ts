import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshSkillsPage`.
 *
 * M2 doctrine: a plugin owns its own `options.<domain>.*` strings instead of
 * depending on the host `en.ts` / `zh-CN.ts` bundles, which T11 will purge of
 * per-plugin keys once every plugin has migrated. This is the exemplar
 * migration referenced by `usePluginT`'s overlay mechanism in
 * `@amiba/i18n/plugin` — see that hook's doc comment for the full contract.
 *
 * Every value below was copied verbatim from the host catalogs at migration
 * time (`packages/i18n/src/en.ts` / `zh-CN.ts`, `options.skills.*` keys).
 * The host keys are intentionally NOT deleted yet — T11 removes them only
 * after all plugins have migrated off the shared bundles.
 */
export const skillsI18n: PluginCatalogOverlay = {
  en: {
    "options.skills.all": "All",
    "options.skills.clearSearch": "Clear search",
    "options.skills.clearFilters": "Clear",
    "options.skills.noMatches": "No skills match the current filters.",
    "options.skills.files": "Files ({count})",
    "options.skills.filesTruncated": "showing the first {count}",
    "options.skills.loading": "Loading…",
    "options.skills.reading": "Reading…",
    "options.skills.noFiles": "No files",
    "options.skills.selectFile":
      "Select a file on the left to view its contents",
    "options.skills.binaryFile": "Binary file · {size}",
    "options.skills.fileTooLarge": "File is too large to preview ({size})",
    "options.skills.dsh.description":
      "Skills are resolved automatically from the active conversation, project, user roots, and agent preset.",
    "options.skills.dsh.create": "Create skill",
    "options.skills.dsh.edit": "Edit skill",
    "options.skills.dsh.name": "Skill name",
    "options.skills.dsh.editorHint":
      "DSH requires YAML frontmatter with matching name and description fields. Invocation policy is controlled by user-invocable and disable-model-invocation.",
    "options.skills.dsh.notInvocable": "Not invocable",
    "options.skills.dsh.sources": "Sources",
    "options.skills.dsh.source.project": "Project",
    "options.skills.dsh.source.project.description":
      "Skills discovered from this workspace's DSH and shared-agent directories.",
    "options.skills.dsh.source.user": "User",
    "options.skills.dsh.source.user.description":
      "Personal skills from the DSH and shared-agent user directories.",
    "options.skills.dsh.source.runtime": "Runtime",
    "options.skills.dsh.source.runtime.description":
      "Skills registered dynamically by the active DSH composition.",
    "options.skills.dsh.source.bundled": "Bundled",
    "options.skills.dsh.source.bundled.description":
      "Read-only skills distributed with the runtime or a plugin.",
    "options.skills.dsh.source.custom": "Custom provider",
    "options.skills.dsh.source.custom.description":
      "Skills contributed by an explicitly configured provider.",
    "options.skills.dsh.source.other": "Other providers",
    "options.skills.dsh.source.other.description":
      "Skills whose provider exposes a non-standard source.",
    "options.skills.dsh.invocation": "Invocation",
    "options.skills.dsh.modelInvocable": "Model callable",
    "options.skills.dsh.userInvocable": "User callable",
    "options.skills.dsh.search":
      "Search name, description, source, or provider…",
    "options.skills.dsh.deleteConfirm": "Delete DSH skill “{name}”?",
  },
  "zh-CN": {
    "options.skills.all": "全部",
    "options.skills.clearSearch": "清除搜索",
    "options.skills.clearFilters": "清除",
    "options.skills.noMatches": "没有符合当前筛选条件的技能。",
    "options.skills.files": "文件（{count}）",
    "options.skills.filesTruncated": "仅显示前 {count} 个",
    "options.skills.loading": "正在加载…",
    "options.skills.reading": "正在读取…",
    "options.skills.noFiles": "没有文件",
    "options.skills.selectFile": "从左侧选择文件以查看内容",
    "options.skills.binaryFile": "二进制文件 · {size}",
    "options.skills.fileTooLarge": "文件过大（{size}），无法预览",
    "options.skills.dsh.description":
      "技能会根据当前会话、项目目录、用户目录和智能体预设自动组合。",
    "options.skills.dsh.create": "新建技能",
    "options.skills.dsh.edit": "编辑技能",
    "options.skills.dsh.name": "技能名称",
    "options.skills.dsh.editorHint":
      "DSH 要求 YAML frontmatter 中包含一致的 name 与 description；调用策略由 user-invocable 和 disable-model-invocation 控制。",
    "options.skills.dsh.notInvocable": "不可调用",
    "options.skills.dsh.sources": "来源",
    "options.skills.dsh.source.project": "当前项目",
    "options.skills.dsh.source.project.description":
      "从当前工作区的 DSH 与共享 Agent 目录发现。",
    "options.skills.dsh.source.user": "用户目录",
    "options.skills.dsh.source.user.description":
      "来自 DSH 与共享 Agent 用户目录的个人技能。",
    "options.skills.dsh.source.runtime": "运行时",
    "options.skills.dsh.source.runtime.description":
      "由当前 DSH 组合在运行时动态注册。",
    "options.skills.dsh.source.bundled": "内置",
    "options.skills.dsh.source.bundled.description":
      "随运行时或插件一起分发的只读技能。",
    "options.skills.dsh.source.custom": "自定义 Provider",
    "options.skills.dsh.source.custom.description":
      "由显式配置的 Skill Provider 提供。",
    "options.skills.dsh.source.other": "其他 Provider",
    "options.skills.dsh.source.other.description":
      "来源类型未归入标准目录的技能。",
    "options.skills.dsh.invocation": "调用方式",
    "options.skills.dsh.modelInvocable": "模型可调用",
    "options.skills.dsh.userInvocable": "用户可调用",
    "options.skills.dsh.search": "搜索名称、说明、来源或 Provider…",
    "options.skills.dsh.deleteConfirm": "确定删除 DSH 技能“{name}”吗？",
  },
};
