import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Cron copy, plugin-owned. "定时任务/cron" here means OUR feature — spawn a
 * fresh task session on schedule — never the official reminder engine.
 */
export const cronI18n: PluginCatalogOverlay = {
  "zh-CN": {
    "cron.title": "定时任务",
    "cron.nav": "定时任务",
    "cron.new": "新建定时任务",
    "cron.refresh": "刷新",
    "cron.empty.title": "还没有定时任务",
    "cron.empty.description":
      "定时任务到点会自动开启一个全新会话执行你的指令，比如生成每日报表、整理新闻。",
    "cron.loading": "正在加载定时任务…",
    "cron.form.name": "任务名称",
    "cron.form.namePlaceholder": "例如：每日新闻整理",
    "cron.form.prompt": "任务指令",
    "cron.form.promptPlaceholder": "到点时，新会话要执行什么？",
    "cron.form.rule": "时间规则",
    "cron.form.rule.at": "指定时间执行一次",
    "cron.form.rule.daily": "每天定时",
    "cron.form.rule.every": "固定间隔",
    "cron.form.at": "执行时间",
    "cron.form.dailyTime": "每天几点（本地时区）",
    "cron.form.everyMinutes": "间隔分钟数",
    "cron.form.catchUp": "错过后在下次启动时补跑一次",
    "cron.form.footnote":
      "任务只在应用运行期间触发；每次运行都会创建一个独立的新会话。",
    "cron.form.create": "创建",
    "cron.form.cancel": "取消",
    "cron.row.nextRun": "下次运行",
    "cron.row.lastRun": "上次运行",
    "cron.row.never": "从未运行",
    "cron.row.exhausted": "已完成",
    "cron.row.disabled": "已停用",
    "cron.row.runNow": "立即运行",
    "cron.row.openLastRun": "打开上次运行",
    "cron.row.delete": "删除",
    "cron.row.enable": "启用",
    "cron.rule.at": "{time} 执行一次",
    "cron.rule.daily": "每天 {time}",
    "cron.rule.every": "每 {minutes} 分钟",
  },
  en: {
    "cron.title": "Cron tasks",
    "cron.nav": "Cron tasks",
    "cron.new": "New cron task",
    "cron.refresh": "Refresh",
    "cron.empty.title": "No cron tasks yet",
    "cron.empty.description":
      "A cron task starts a fresh session on schedule to run your instructions — daily reports, news digests, and the like.",
    "cron.loading": "Loading cron tasks…",
    "cron.form.name": "Task name",
    "cron.form.namePlaceholder": "e.g. Daily news digest",
    "cron.form.prompt": "Task instructions",
    "cron.form.promptPlaceholder":
      "What should the fresh session do when this fires?",
    "cron.form.rule": "Timing rule",
    "cron.form.rule.at": "Once at a time",
    "cron.form.rule.daily": "Daily at",
    "cron.form.rule.every": "Fixed interval",
    "cron.form.at": "Run at",
    "cron.form.dailyTime": "Time of day (local zone)",
    "cron.form.everyMinutes": "Interval in minutes",
    "cron.form.catchUp": "Run once at next launch if missed",
    "cron.form.footnote":
      "Tasks fire only while the app is running; every run opens its own fresh session.",
    "cron.form.create": "Create",
    "cron.form.cancel": "Cancel",
    "cron.row.nextRun": "Next run",
    "cron.row.lastRun": "Last run",
    "cron.row.never": "Never ran",
    "cron.row.exhausted": "Completed",
    "cron.row.disabled": "Disabled",
    "cron.row.runNow": "Run now",
    "cron.row.openLastRun": "Open last run",
    "cron.row.delete": "Delete",
    "cron.row.enable": "Enabled",
    "cron.rule.at": "Once at {time}",
    "cron.rule.daily": "Daily at {time}",
    "cron.rule.every": "Every {minutes} min",
  },
};

export type CronMessageKey = keyof (typeof cronI18n)["zh-CN"];
