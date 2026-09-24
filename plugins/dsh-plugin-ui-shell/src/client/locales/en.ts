/**
 * The app-shell's own English copy: strings rendered by
 * `product-shell.tsx`, which is this plugin's component rather than a
 * `@amiba/ui` one.
 *
 * Merged with `@amiba/ui/locales` and registered as ONE official namespace by
 * `./messages.ts`.
 */
export const en = {
  "shell.feedback.title": "Send feedback to DeepSeek",
  "shell.feedback.destination": "Feedback and current conversation logs are sent to DeepSeek. Amiba does not receive or collect this data.",
  "shell.feedback.placeholder": "Describe the issue or suggestion…",
  "shell.feedback.submit": "Submit to DeepSeek",
  "app.initializing": "Waking your local agent",
  "shell.ask.action": "Ask the user",
  "shell.ask.waiting": "Waiting for answers…",
  "shell.ask.answered": "{answered}/{total} answered",
  "shell.ask.cancelled": "Dismissed by the user",
  "shell.ask.skipped": "Not answered",
  "shell.settings.language": "Language",
  "shell.tool.runCode": "Run code",
  "shell.tool.submitPlan": "Submit plan",
  "shell.tool.runWorkflow": "Run workflow",
  "shell.tool.reportProgress": "Report progress",
  "shell.inspect.serviceAction": "Query app capabilities",
  "shell.inspect.themeAction": "Query theme variables",
  "shell.tool.inspectRuntime": "Inspect runtime",
  "shell.tool.defineRuntime": "Define runtime module",
  "shell.tool.runRuntime": "Run module",
  "shell.tool.stopRuntime": "Stop module",
  "shell.tool.removeRuntime": "Remove module",
  "shell.tool.runCommand": "Run command",
  "shell.tool.readFile": "Read file",
  "shell.tool.inspectImage": "Inspect image",
  "shell.tool.editFile": "Edit file",
  "shell.tool.writeFile": "Write file",
  "shell.tool.searchFiles": "Search files",
  "shell.tool.updateTasks": "Update todos",
  "shell.tool.useSkill": "Use skill",
  "shell.tool.searchWeb": "Search the web",
  "shell.tool.readWeb": "Read page",
  "shell.tool.waitJob": "Wait for task result",
  "shell.tool.readJob": "Read task result",
  "shell.tool.listJobs": "List tasks",
  "shell.tool.stopJob": "Stop task",
  "shell.tool.manageJobs": "Manage background jobs",
  "shell.goal.create": "Create goal",
  "shell.goal.read": "Read goal",
  "shell.goal.edit": "Edit goal",
  "shell.goal.pause": "Pause goal",
  "shell.goal.resume": "Resume goal",
  "shell.goal.complete": "Complete goal",
  "shell.goal.blocked": "Mark goal blocked",
  "shell.goal.objective": "Objective",
  "shell.goal.phase": "Status",
  "shell.goal.phase.active": "Active",
  "shell.goal.phase.paused": "Paused",
  "shell.goal.phase.complete": "Complete",
  "shell.goal.phase.blocked": "Blocked",
  "shell.goal.empty": "No goal",
  "shell.tool.manageGoal": "Track goal",
  "shell.tool.delegate": "Delegate",
  "shell.tool.controlAgent": "Steer subagent",
  "shell.tool.runLoop": "Run loop",
  "shell.tool.updatePlan": "Update plan",
  "shell.tool.manageReminders": "Manage reminders",
} as const;

/** Every key the shell's own copy defines. */
export type ShellMessageKey = keyof typeof en;
/** Both-language parity, compile-enforced. */
export type ShellMessages = Record<ShellMessageKey, string>;
