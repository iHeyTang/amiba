import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for the Usage plugin's Tools activity view.
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host `en.ts` / `zh-CN.ts` bundles, which T11 will purge of per-plugin
 * keys once every plugin has migrated. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` — the overlay is passed
 * to `usePluginT` and its keys take precedence over the host catalog.
 *
 * Every `usage.*` value below was copied verbatim from the host catalogs
 * at migration time (`packages/i18n/src/en.ts` / `zh-CN.ts`). The host
 * keys are intentionally NOT deleted yet — T11 removes them only after
 * all plugins have migrated off the shared bundles. The `usage.tab.*`
 * keys are new plugin-owned copy for the section's Tokens/Tools switch.
 *
 * (The Tokens view keeps its own older-style `labels()` dict in
 * `TokensTab.tsx`; this overlay covers the Tools view + the tab strip.)
 */
export const usageToolsI18n: PluginCatalogOverlay = {
  en: {
    "usage.tab.tokens": "Tokens",
    "usage.tab.tools": "Tools",
    "usage.range.today": "Today",
    "usage.range.lastN": "{n}d",
    "usage.heatmap.dow.mon": "M",
    "usage.heatmap.dow.wed": "W",
    "usage.heatmap.dow.fri": "F",
    "usage.heatmap.legend.less": "Less",
    "usage.heatmap.legend.more": "More",
    "usage.heatmap.tooltip.none": "no activity",
    "usage.label.noData": "No data yet.",
    "usage.label.percentage": "{pct}%",
    "usage.tools.hero.calls": "Calls",
    "usage.tools.hero.tools": "Tools",
    "usage.tools.hero.unfinished": "Unfinished",
    "usage.tools.section.activity": "Activity",
    "usage.tools.section.trend": "Activity trend",
    "usage.tools.section.byTool": "By tool",
    "usage.tools.section.recent": "Recent calls",
    "usage.tools.heatmap.tooltip.calls": "calls",
    "usage.tools.label.calls": "{count} calls",
    "usage.tools.label.running": "Running",
    "usage.tools.label.completed": "{ms}ms",
    "usage.tools.footer.source": "Local capture · auto-refreshes every 30 s",
  },
  "zh-CN": {
    "usage.tab.tokens": "Tokens",
    "usage.tab.tools": "工具",
    "usage.range.today": "今天",
    "usage.range.lastN": "{n} 天",
    "usage.heatmap.dow.mon": "一",
    "usage.heatmap.dow.wed": "三",
    "usage.heatmap.dow.fri": "五",
    "usage.heatmap.legend.less": "少",
    "usage.heatmap.legend.more": "多",
    "usage.heatmap.tooltip.none": "无活动",
    "usage.label.noData": "暂无数据。",
    "usage.label.percentage": "{pct}%",
    "usage.tools.hero.calls": "调用次数",
    "usage.tools.hero.tools": "工具种类",
    "usage.tools.hero.unfinished": "未完成",
    "usage.tools.section.activity": "活跃度",
    "usage.tools.section.trend": "调用趋势",
    "usage.tools.section.byTool": "按工具",
    "usage.tools.section.recent": "最近调用",
    "usage.tools.heatmap.tooltip.calls": "次调用",
    "usage.tools.label.calls": "{count} 次",
    "usage.tools.label.running": "运行中",
    "usage.tools.label.completed": "{ms}ms",
    "usage.tools.footer.source": "本地采集 · 每 30 秒自动刷新",
  },
};
