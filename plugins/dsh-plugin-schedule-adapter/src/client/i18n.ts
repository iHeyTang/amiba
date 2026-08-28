import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshScheduledTasksPage`.
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host catalogs. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` — the overlay is passed
 * to `usePluginT` and its keys take precedence over the host catalog.
 *
 * Every value below was copied verbatim from the host catalogs at
 * migration time (the host catalogs). Shared
 * `common.*` vocabulary intentionally stays host-side and is NOT copied.
 */
export const schedulesI18n: PluginCatalogOverlay = {
  en: {
    "options.cron.title": "Session reminders",
    "options.cron.refresh": "Refresh",
    "options.cron.search": "Search scheduled tasks",
    "options.cron.search.empty": "No matching tasks",
    "options.cron.filter.label": "Filter reminders",
    "options.cron.filter.all": "All",
    "options.cron.loading": "Loading reminders…",
    "options.cron.empty.title": "No session reminders yet",
    "options.cron.form.createAction": "Create",
    "options.cron.action.copyId": "Copy task ID",
    "options.cron.action.delete": "Delete task",
    "options.cron.dsh.new": "New reminder",
    "options.cron.dsh.session": "Owning conversation",
    "options.cron.dsh.noSession":
      "Create a conversation before adding a reminder",
    "options.cron.dsh.prompt": "Reminder content",
    "options.cron.dsh.prompt.placeholder":
      "What should this conversation handle when the reminder becomes due?",
    "options.cron.dsh.rule": "Timing",
    "options.cron.dsh.rule.after": "After a delay",
    "options.cron.dsh.rule.at": "At a date and time",
    "options.cron.dsh.rule.every": "Fixed interval",
    "options.cron.dsh.at": "Date and time",
    "options.cron.dsh.minutes": "Minutes",
    "options.cron.dsh.sessionHint":
      "The reminder is persisted in the selected DSH session. Recurring intervals must be at least five minutes.",
    "options.cron.dsh.overdue": "Overdue",
    "options.cron.dsh.filter.scheduled": "Scheduled",
    "options.cron.dsh.filter.overdue": "Overdue",
    "options.cron.dsh.deleteConfirm": "Delete reminder “{name}”?",
    "options.cron.dsh.error.prompt": "Reminder content is required.",
    "options.cron.dsh.error.future": "Choose a time in the future.",
    "options.cron.dsh.error.interval":
      "Recurring intervals must be a whole number of at least five minutes.",
    "options.cron.dsh.error.delay":
      "The delay must be a positive whole number of minutes.",
  },
  "zh-CN": {
    "options.cron.title": "会话提醒",
    "options.cron.refresh": "刷新",
    "options.cron.search": "搜索已安排的任务",
    "options.cron.search.empty": "没有找到匹配的任务",
    "options.cron.filter.label": "筛选提醒",
    "options.cron.filter.all": "全部",
    "options.cron.loading": "正在加载提醒…",
    "options.cron.empty.title": "还没有会话提醒",
    "options.cron.form.createAction": "创建",
    "options.cron.action.copyId": "复制任务 ID",
    "options.cron.action.delete": "删除任务",
    "options.cron.dsh.new": "新建提醒",
    "options.cron.dsh.session": "所属会话",
    "options.cron.dsh.noSession": "请先创建一个会话，再添加提醒",
    "options.cron.dsh.prompt": "提醒内容",
    "options.cron.dsh.prompt.placeholder":
      "提醒到期时，希望这个会话继续处理什么？",
    "options.cron.dsh.rule": "时间规则",
    "options.cron.dsh.rule.after": "延迟后执行",
    "options.cron.dsh.rule.at": "指定日期时间",
    "options.cron.dsh.rule.every": "固定间隔",
    "options.cron.dsh.at": "日期和时间",
    "options.cron.dsh.minutes": "分钟",
    "options.cron.dsh.sessionHint":
      "提醒会持久化在所选 DSH 会话中；循环间隔最短为 5 分钟。",
    "options.cron.dsh.overdue": "已到期",
    "options.cron.dsh.filter.scheduled": "待执行",
    "options.cron.dsh.filter.overdue": "已到期",
    "options.cron.dsh.deleteConfirm": "确定删除提醒“{name}”吗？",
    "options.cron.dsh.error.prompt": "请输入提醒内容。",
    "options.cron.dsh.error.future": "请选择未来的时间。",
    "options.cron.dsh.error.interval": "循环间隔必须是至少 5 分钟的整数。",
    "options.cron.dsh.error.delay": "延迟时间必须是大于 0 的整数分钟。",
  },
};
