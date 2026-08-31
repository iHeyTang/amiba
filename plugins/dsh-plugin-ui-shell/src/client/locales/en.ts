/**
 * The app-shell's own English copy: strings rendered by
 * `product-shell.tsx`, which is this plugin's component rather than a
 * `@amiba/ui` one.
 *
 * Merged with `@amiba/ui/locales` and registered as ONE official namespace by
 * `./messages.ts`.
 */
export const en = {
  "app.initializing": "Waking your local agent",
  "shell.ask.action": "Ask the user",
  "shell.ask.waiting": "Waiting for answers…",
  "shell.ask.answered": "{answered}/{total} answered",
  "shell.ask.cancelled": "Dismissed by the user",
  "shell.ask.skipped": "Not answered",
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
  "shell.tool.manageJobs": "Manage background jobs",
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
