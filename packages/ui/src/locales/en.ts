/**
 * English message catalog for the Amiba UI components in this package — the
 * copy `@amiba/ui`'s own surfaces render through `useT()`, plus the shared
 * vocabulary (`common.*`) that plugin components reach for through
 * `usePluginT`'s host fallback.
 *
 * ## This module is a SEPARATE ENTRY POINT on purpose
 *
 * It is reachable only as `@amiba/ui/locales`. Nothing under
 * `packages/ui/src` may import it except `./keys.ts` (type-only) — if a
 * component file could reach the dictionary through the same import graph as
 * the components, every plugin bundle that renders one Amiba component would
 * inline all ~82 KB of it again, which is the whole cost this split removes.
 * `scripts/verify-dsh-architecture.mjs` enforces the isolation, and a
 * bundle-purity assertion over every built plugin `lib/client.js` proves it
 * on the emitted output rather than on the source.
 *
 * The ONE importer inside the plugin graph is
 * `@amiba/dsh-plugin-ui-shell`, which merges this with its own dictionary and
 * registers the result with the official locale service under a single
 * namespace. The runtime-less windows (Quick-Ask, the notifier) import it too
 * — they have no locale service to register with.
 *
 * To add a string:
 *   1. Add the key here.
 *   2. Add the same key to `zh-CN.ts` (TypeScript enforces this through
 *      `UiMessages`, and `ctx.locale.register`'s typed overload enforces it
 *      a second time at the registration site).
 *   3. Use `t("your.key")` in components via `useT()`.
 */
export const en = {
  // Generic
  "common.add": "Add",
  "common.cancel": "Cancel",
  "common.back": "Back",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.close": "Close",
  "common.refresh": "Refresh",
  "common.confirm": "Confirm",
  "common.loading": "Loading…",
  "common.saving": "Saving…",
  "common.copy": "Copy",
  "common.retry": "Retry",
  "common.untitled": "Untitled",

  // Heads-up notifier
  "notifier.dismiss": "Dismiss notification",

  // Conversation turn navigation
  "conversationRail.label": "Conversation navigation",
  "conversationRail.jumpTo": "Jump to message {index}: {message}",
  "conversationRail.messageFallback": "User message",

  // Assistant run boundaries
  "sidepanel.runBoundary.interrupted": "Response interrupted",
  "sidepanel.runBoundary.stopped": "Stopped",

  // Chat error recovery
  "sidepanel.runError.credentials.title": "Model credentials aren't working",
  "sidepanel.runError.credentials.action": "Review credentials",
  "sidepanel.runError.modelService.title": "The model service is unavailable",
  "sidepanel.runError.modelService.action": "Review model settings",
  "sidepanel.runError.connection.title": "Couldn't reach the model service",
  "sidepanel.runError.connection.action": "Check connection",
  "sidepanel.runError.runtime.title": "The run couldn't continue",
  "sidepanel.runError.runtime.action": "View error logs",

  // Workspace inspector
  "workspacePane.title": "Workbench",
  "workspacePane.tabs": "Workbench views",
  "workspacePane.open": "Open workbench",
  "workspacePane.collapse": "Collapse workbench",
  "workspacePane.resize": "Resize workbench",
  "workspacePane.emptyTitle": "Nothing open yet",
  "workspacePane.emptyBody":
    "Files, changes, and code run results opened from the conversation will appear here.",
  "workspacePane.emptyFiles": "Files",
  "workspacePane.emptyChanges": "Changes",
  "workspacePane.emptyRuns": "Code runs",
  "workspacePane.loadingFile": "Opening file…",
  "workspacePane.refreshing": "Refreshing from disk…",
  "workspacePane.fileUnavailable": "This file could not be opened.",
  "workspacePane.fileDeleted": "This file was removed from the workspace.",
  "workspacePane.binaryFile": "Binary preview is not available yet",
  "workspacePane.truncated": "Previewing the first 2 MB of a {size} file",
  "workspacePane.filesChanged": "{count} files changed",
  "workspacePane.openToolResource": "Open in workbench",
  "workspacePane.review": "Review",
  "workspacePane.showMoreFiles": "{count} more files",
  "workspacePane.showFewerFiles": "Show fewer files",
  "workspacePane.currentTurn": "Current turn",
  "workspacePane.toolChange": "Tool change",
  "workspacePane.noDiff": "No reviewable diff was returned.",
  "workspacePane.unmodifiedLines": "{count} unmodified lines",
  "workspacePane.moreUnmodifiedLines": "{count} more unmodified lines",
  "workspacePane.diffViewMode": "Diff view",
  "workspacePane.unifiedDiff": "Unified view",
  "workspacePane.splitDiff": "Side-by-side view",
  "workspacePane.beforeChange": "Before",
  "workspacePane.afterChange": "After",
  "workspacePane.contextUnavailable": "Full file context is unavailable",
  "workspacePane.openFile": "Open file",
  "workspacePane.openFileHint": "Choose a file from the workspace tree",
  "workspacePane.showFileTree": "Show file tree",
  "workspacePane.hideFileTree": "Hide file tree",
  "workspacePane.copyPath": "Copy path",
  "workspacePane.revealFile": "Reveal in Finder",
  "workspacePane.openExternal": "Open with default app",
  "workspacePane.expandFile": "Expand file",
  "workspacePane.collapseFile": "Collapse file",
  "workspacePane.expandAll": "Expand all",
  "workspacePane.collapseAll": "Collapse all",
  "workspacePane.moreActions": "More actions",
  "workspacePane.codeRun": "Run code",
  "workspacePane.code": "Code",
  "workspacePane.output": "Output",
  "workspacePane.running": "Running",
  "workspacePane.failed": "Failed",
  "workspacePane.noOutput": "No output",
  "workspacePane.copyCode": "Copy code",
  "workspacePane.copyOutput": "Copy output",
  "workspacePane.copyWorkingDirectory": "Copy working directory",
  "workspacePane.files": "Files",
  "workspacePane.project": "Project",
  "workspacePane.projects": "Projects",
  "workspacePane.switchProject": "Switch project",
  "workspacePane.locations": "Locations",
  "workspacePane.newProject": "New project from folder",
  "workspacePane.addFolder": "Add folder to project",
  "workspacePane.searchFiles": "Search files",
  "workspacePane.noFiles": "No matching files",
  "workspacePane.clean": "Working tree clean",
  "workspacePane.stage": "Stage",
  "workspacePane.unstage": "Unstage",
  "workspacePane.commitMessage": "Commit message",
  "workspacePane.commit": "Commit",
  "workspacePane.ship": "Push",
  "workspacePane.noWorkingChanges": "No uncommitted changes",
  "workspacePane.terminal": "Terminal",
  "workspacePane.startingTerminal": "Starting terminal…",
  "workspacePane.terminalStopped": "Stopped",
  "workspacePane.openTerminal": "Open terminal",
  "workspacePane.closeTerminal": "Close terminal",
  "workspacePane.resizeTerminal": "Resize terminal",
  "workspacePane.terminalTabs": "Open terminals",
  "workspacePane.newTerminal": "New terminal",
  "workspacePane.closeTerminalTab": "Close {title}",
  "workspacePane.hideTerminalPanel": "Hide terminal panel",

  // Embedded browser
  "embeddedBrowser.title": "Browser",
  "embeddedBrowser.open": "Open browser",
  "embeddedBrowser.close": "Close browser",
  "embeddedBrowser.newTab": "New tab",
  "embeddedBrowser.back": "Back",
  "embeddedBrowser.forward": "Forward",
  "embeddedBrowser.stop": "Stop loading",
  "embeddedBrowser.addressPlaceholder": "Type a URL",
  "embeddedBrowser.openExternal": "Open in default browser",
  "embeddedBrowser.emptyTitle": "Browse and verify",
  "embeddedBrowser.emptyDescription":
    "Amiba can browse, click, type, and take screenshots here. Enter a URL above to start.",
  "embeddedBrowser.previewPrompt": "Preview your app instead?",
  "embeddedBrowser.detectDevServer": "Detect dev server",
  "embeddedBrowser.detecting": "Detecting…",
  "embeddedBrowser.noDevServer": "No local dev server detected",
  "embeddedBrowser.agentOperating": "Agent is browsing",
  "workspacePane.recoveryPoints": "Recovery points",
  "workspacePane.recoveryPointsHint":
    "Automatic safety snapshots created before Agent changes.",
  "workspacePane.recoveryTask": "Before task {count}",
  "workspacePane.recoverySafety": "Before the last restore",
  "workspacePane.snapshotFiles": "{count} uncommitted files at this point",
  "workspacePane.recoveryIncomplete": "Incomplete backup",
  "workspacePane.deleteRecovery": "Delete recovery point",
  "workspacePane.deleteRecoveryConfirm":
    "Delete this recovery point permanently?",
  "workspacePane.restore": "Restore",
  "workspacePane.noCheckpoints": "No recovery points yet",

  // App shell
  "app.title": "Amiba",

  // Options nav
  "options.nav.appearance": "Appearance",
  "options.nav.shortcuts": "Shortcuts",
  "options.nav.status": "Status",
  "options.nav.logs": "Logs",
  "options.nav.section.general": "General",
  "options.nav.section.agent": "Assistant",
  "options.nav.section.advanced": "Advanced",

  // Task agent picker
  "sidepanel.agentPicker.label": "Choose agent",
  "sidepanel.agentPicker.description":
    "Choose the assistant responsible for this task.",
  "sidepanel.agentPicker.search": "Search agents…",
  "sidepanel.agentPicker.empty": "No matching agents",
  "sidepanel.agentPicker.loadFailed": "Couldn't load agents",
  "sidepanel.agentPicker.profileLocked": "Fixed for this task",
  "sidepanel.agentPicker.executionIdentity": "Execution identity",
  "sidepanel.agentPicker.executionIdentityDescription":
    "Choose the DSH Agent Preset for this task.",
  "sidepanel.agentPicker.defaultProfile": "Amiba",
  "sidepanel.agentPicker.agent": "Agent",

  // DSH permission presets
  "sidepanel.approvalMode.label": "Risk handling",
  "sidepanel.approvalMode.loadFailed":
    "Couldn't load approval mode. Click to retry.",
  "sidepanel.approvalMode.saveFailed":
    "Couldn't change approval mode. Try again.",
  "sidepanel.permissionPreset.question": "File and command access:",
  "sidepanel.permissionPreset.readOnly": "Read only",
  "sidepanel.permissionPreset.readOnlyDescription":
    "Inspect the workspace without changing files.",
  "sidepanel.permissionPreset.workspaceWrite": "Workspace access",
  "sidepanel.permissionPreset.workspaceWriteDescription":
    "Write inside the workspace and ask before operations that need approval.",
  "sidepanel.permissionPreset.fullAccess": "Full access",
  "sidepanel.permissionPreset.fullAccessDescription":
    "Run without sandbox confinement or approval prompts.",
  "sidepanel.permissionPreset.customDescription":
    "A permission preset supplied by the active DSH composition.",
  "sidepanel.permissionPreset.fullAccessAcknowledge":
    "I understand this lets the agent modify files and run commands without asking.",
  "sidepanel.permissionPreset.enableFullAccess": "Enable full access",

  // Composer notices and mentions
  "composer.notice.showDetails": "Details",
  "composer.notice.hideDetails": "Hide",
  "composer.mention.typeToSearch": "Type a keyword to search",
  "composer.mention.noResults": "No results",

  "newtab.dropOverlay": "Drop files to attach",
  // Preference page
  "options.preference.subtitle": "Desktop UI and behavior",
  "options.preference.hotkey.label": "Summon hotkey",
  "options.preference.hotkey.desc":
    "Bring Amiba to the front from any app when this binding fires.",
  "options.preference.hotkey.mode.disabled": "Off",
  "options.preference.hotkey.mode.doubleTap": "Double-tap modifier",
  "options.preference.hotkey.mode.accelerator": "Key combo",
  "options.preference.hotkey.modifier.label": "Modifier",
  "options.preference.hotkey.modifier.Meta": "Cmd / Win",
  "options.preference.hotkey.modifier.Control": "Ctrl",
  "options.preference.hotkey.modifier.Alt": "Alt / Option",
  "options.preference.hotkey.modifier.Shift": "Shift",
  "options.preference.hotkey.accelerator.label": "Key combo",
  "options.preference.hotkey.accelerator.placeholder":
    "e.g. CommandOrControl+Shift+H",
  "options.preference.hotkey.accelerator.hint":
    "Electron accelerator syntax — write modifiers as Cmd / Ctrl / Alt / Shift / CommandOrControl.",
  "options.preference.hotkey.macHint":
    "First time you turn double-tap on, macOS asks for Accessibility access; the hook can only see global key presses after you grant it.",

  "options.preference.theme": "Theme",
  "options.preference.theme.auto": "Auto",
  "options.preference.theme.light": "Light",
  "options.preference.theme.dark": "Dark",
  "options.preference.accent": "Accent",
  "options.preference.accent.violet": "Electric Violet",
  "options.preference.accent.coral": "Vivid Coral",
  "options.preference.accent.cyan": "Electric Cyan",
  "options.preference.accent.lime": "Acid Lime",
  "options.preference.accent.graphite": "Graphite",
  // No `options.preference.language*` keys: the 语言 row is the official
  // locale plugin's own, registered into `settings.general.item` and
  // localized from its `settings.locale` namespace. Amiba's competing row
  // was retired when the official locale service became the single language
  // authority.
  "options.preference.newtab.wallpaper.label": "Daily wallpaper",

  // Models / DSH model config
  "options.models.display.title": "Service providers",
  "options.models.display.search": "Search providers or models…",
  "options.models.display.empty": "No matching providers or models.",
  "options.models.display.current": "Current",
  "options.models.display.currentModel": "Current main model",
  "options.models.display.availableModels": "{count} models",
  "options.models.display.providerToggle": "Show {name} in model menus",
  "options.models.display.configureProvider": "Configure {name}",
  "options.models.display.modelToggle": "Show {name} in model menus",
  "options.models.display.noModels":
    "No models are currently available from this provider.",
  "options.models.card.context": "Context",
  "options.models.card.maxInput": "Max input",
  "options.models.card.maxOutput": "Max output",
  "options.models.card.inputPrice": "Input",
  "options.models.card.outputPrice": "Output",
  "options.models.card.cacheRead": "Cache read",
  "options.models.card.cacheWrite": "Cache write",
  "options.models.card.free": "Free",
  "options.models.card.group.capabilities": "Capabilities",
  "options.models.card.group.limits": "Limits",
  "options.models.card.group.pricing": "Pricing reference",
  "options.models.card.group.reference": "Reference",
  "options.models.card.capability.reasoning": "Reasoning",
  "options.models.card.capability.tools": "Tool calling",
  "options.models.card.capability.vision": "Vision",
  "options.models.card.capability.structuredOutput": "Structured output",
  "options.models.card.capability.temperature": "Temperature control",
  "options.models.card.capability.openWeights": "Open weights",
  "options.models.card.capability.fastMode": "Fast mode",
  "options.models.card.capability.interleavedReasoning":
    "Interleaved reasoning",
  "options.models.card.capability.pdf": "PDF input",
  "options.models.card.capability.audioInput": "Audio input",
  "options.models.card.capability.videoInput": "Video input",
  "options.models.card.capability.imageOutput": "Image output",
  "options.models.card.capability.audioOutput": "Audio output",
  "options.models.card.capability.videoOutput": "Video output",
  "options.models.card.capability.pdfOutput": "PDF output",
  "options.models.card.inputModalities": "Input modalities",
  "options.models.card.outputModalities": "Output modalities",
  "options.models.card.family": "Model family",
  "options.models.card.knowledgeCutoff": "Knowledge cutoff",
  "options.models.card.releaseDate": "Released",
  "options.models.card.status": "Lifecycle",
  "options.models.details.openFor": "View details for {name}",
  "options.models.details.dialogDescription":
    "Extended model information and its available data sources.",
  "options.models.config.defaultsTitle": "Model assignments",
  "options.models.config.main": "Default model",
  "options.models.config.mainUnset": "Not set — choose a model",
  "options.models.config.searchForTask": "Search models for {task}…",
  "options.models.config.pickerTitle": "Choose a model for {task}",
  "options.models.config.pickerDescription":
    "Search configured providers and assign a model to this task.",
  "options.models.provider.addCustom": "Add custom endpoint",
  "options.models.provider.credentialValue": "Credential",
  "options.models.provider.credentialPlaceholder": "Enter access credential",
  "options.models.provider.models": "Available models",
  "options.models.provider.noModels":
    "No models are available yet. Save the required credentials, then refresh this list.",

  // Status + logs
  "options.status.dsh.subtitle":
    "Health and identity of Amiba's immutable managed DSH runtime.",
  "options.status.dsh.healthy": "DeepSeek Harness is ready",
  "options.status.dsh.unhealthy": "DeepSeek Harness needs attention",
  "options.status.dsh.managed":
    "Bundled and supervised by Amiba; updates ship with the application.",
  "options.status.dsh.restart": "Restart DSH",
  "options.status.dsh.restartConfirm":
    "Restart DeepSeek Harness? Running tasks will be interrupted, but their durable sessions are preserved.",
  "options.status.dsh.runtime": "Managed runtime",
  "options.status.dsh.version": "DSH version",
  "options.status.dsh.node": "Bundled Node.js",
  "options.status.dsh.process": "Process",
  "options.status.dsh.sessions": "Live / durable sessions",
  "options.status.dsh.paths": "Isolated storage",
  "options.status.dsh.bundle": "Runtime bundle",
  "options.status.dsh.lastChecked": "Checked {time}",
  "options.logs.dsh.subtitle":
    "Bounded stdout, stderr and lifecycle output from the managed DSH process.",
  "options.logs.dsh.stream": "Stream",
  "options.logs.autoRefresh": "Auto",
  "options.logs.live": "live",
  "options.logs.empty": "No matching log lines.",
  "options.logs.lineCount": "{count} lines",
  "options.logs.level.label": "Level",
  "options.logs.lines.label": "Lines",
  "options.logs.search.label": "Search",
  "options.logs.search.placeholder": "Substring filter (case-insensitive)",

  // Sidepanel
  "sidepanel.tabbar.empty.before": "No open sessions — tap",
  "sidepanel.tabbar.empty.after": "or pick one from History",
  "sidepanel.tabbar.button.new": "New task",
  "sidepanel.tabbar.button.history": "History",
  "sidepanel.tabbar.button.settings": "Settings",
  "sidepanel.tabbar.tab.close": "Close tab (session is kept in History)",
  "sidepanel.tabbar.tab.closeAria": "Close tab",
  "sidepanel.tabbar.menu.close": "Close",
  "sidepanel.tabbar.menu.closeOthers": "Close others",
  "sidepanel.tabbar.menu.closeRight": "Close to the right",
  "sidepanel.tabbar.menu.closeAll": "Close all",
  "sidepanel.placeholder": "Message Amiba…",
  "sidepanel.placeholder.uploading": "Waiting for attachment upload to finish…",
  "sidepanel.placeholder.withAttachments": "Add a question about your file(s)…",
  "sidepanel.send.tooltip": "Send (⌘/Ctrl+Enter)",
  "sidepanel.modelPicker.label": "Choose model",
  "sidepanel.modelPicker.description":
    "Search and choose the model used for new task runs.",
  "sidepanel.modelPicker.search": "Search models or providers…",
  "sidepanel.modelPicker.noMatches": "No matching models.",
  "sidepanel.modelPicker.loading": "Loading available models…",
  "sidepanel.modelPicker.loadFailed": "Couldn’t load models. Reopen to retry.",
  "sidepanel.modelPicker.reasoningEffort": "Reasoning effort",
  "sidepanel.queue.tooltip": "Queue: send after the current turn finishes",
  "sidepanel.stop": "Stop generation",
  "sidepanel.trace.thoughtProcess": "Thought process",
  "sidepanel.trace.thoughtForSeconds": "Thought for {seconds}s",
  "sidepanel.trace.thoughtForMinutes": "Thought for {minutes}m {seconds}s",
  "sidepanel.trace.workedForSeconds": "Worked for {seconds}s",
  "sidepanel.trace.workedForMinutes": "Worked for {minutes}m {seconds}s",
  "sidepanel.trace.thinking": "Thinking…",
  "sidepanel.trace.toolDetails": "Tool-call details",
  "sidepanel.trace.executionDetails": "Execution details",
  "sidepanel.trace.toolCount": "{count} tool calls",
  "sidepanel.trace.generating": "Generating answer…",
  "sidepanel.trace.expandDetails": "Show details",
  "sidepanel.trace.collapseDetails": "Hide details",
  "sidepanel.trace.actions.useTool": "Use tool",
  "sidepanel.trace.searchResults.count": "{count} results",
  "sidepanel.trace.searchResults.matches": "{count} matches",
  "sidepanel.trace.searchResults.truncated": "Results truncated",
  "sidepanel.trace.searchResults.empty": "No matching files",
  "sidepanel.trace.searchResults.openFile": "Open file in workbench",
  "sidepanel.attach": "Attach files",
  "sidepanel.queue.sendNow":
    "Send now: jump this message to the front of the queue",
  "sidepanel.queue.sendNow.aria": "Send now",
  "sidepanel.queue.edit.aria": "Edit",
  "sidepanel.queue.delete": "Delete",
  "sidepanel.queue.editing": "This message is being edited in the composer",
  "sidepanel.message.branch": "Branch from here",
  "sidepanel.message.notPersisted":
    "This message is still being saved. Try again in a moment.",
  "sidepanel.message.restoreWorkspace": "Restore files to here",
  "sidepanel.message.restoreWorkspaceConfirm":
    "Restore the workspace to before this task? Current file changes will be backed up automatically first.",
  "sidepanel.composer.cancelEdit":
    "Cancel edit (discards composer changes; the queued item is unchanged)",
  "sidepanel.composer.cancelEdit.aria": "Cancel edit",
  "sidepanel.composer.kbd.send": "send",
  "sidepanel.composer.kbd.newline": "newline",
  "quickAsk.selectionFrom": "Selection from",
  "sidepanel.permission.allowOnce": "Allow once",
  "sidepanel.permission.allowOnce.desc":
    "Allow this time only; ask again next time",
  "sidepanel.permission.allowSession": "Allow this session",
  "sidepanel.permission.allowSession.desc":
    "Don't ask again for the rest of this chat",
  "sidepanel.permission.allowAlways": "Always allow",
  "sidepanel.permission.allowAlways.desc":
    "Remember this command; don't ask again",
  "sidepanel.permission.deny": "Deny",
  "sidepanel.permission.deny.desc": "Refuse; the agent receives an error",
  "sidepanel.permission.approvalNeeded": "Approval needed",
  "sidepanel.permission.reason.unverifiedEmbeddedScript":
    "This command contains an embedded script that could not be fully verified. Confirm before running it.",
  "sidepanel.permission.reason.parserLimit":
    "This command is too complex to fully verify. Confirm before running it.",
  "sidepanel.permission.allowedOnce": "Allowed once",
  "sidepanel.permission.allowedOnce.tooltip":
    "Approved for this execution only",
  "sidepanel.permission.allowedSession": "Allowed this session",
  "sidepanel.permission.allowedSession.tooltip":
    "Won't ask again for the rest of this session",
  "sidepanel.permission.allowedAlways": "Always allowed",
  "sidepanel.permission.allowedAlways.tooltip":
    "Added to the permanent allowlist (command_allowlist)",
  "sidepanel.permission.denied": "Denied",
  "sidepanel.permission.denied.tooltip": "User denied this command",
  "sidepanel.permission.expired": "Expired",
  "sidepanel.permission.expired.tooltip":
    "The approval deadline elapsed; DSH denied the request so execution could continue safely",
  "sidepanel.permission.submitFailed": "Submit failed",
  "sidepanel.permission.submitFailed.tooltip":
    "DSH did not accept the approval decision for run {runId}",
  "sidepanel.permission.waiting": "Waiting",
  "sidepanel.permission.chip.tool": "Tool: {tool}",
  "sidepanel.permission.chip.command": "Command: {command}",
  "sidepanel.permission.chip.reason": "Reason: {reason}",
  "sidepanel.permission.chip.requested": "Requested: {time}",
  "sidepanel.permission.chip.decided": "Decided: {time}",
  "sidepanel.permission.dismissError": "Dismiss error",
  "sidepanel.attachment.uploading": "Uploading",
  "sidepanel.attachment.removeAria": "Remove {name}",
  "sidepanel.attachment.openInBrowser": "Open {name} in your browser",
  "sidepanel.attachment.remove": "Remove",
  "sidepanel.attachment.previewTooltip": "Click to preview",
  "sidepanel.attachment.previewAria": "Open larger preview of {name}",
  "sidepanel.empty.title": "No task open",
  "sidepanel.empty.withHistory":
    "Start a new task or pick one up from History.",
  "sidepanel.empty.firstChat": "Create your first task with Amiba.",
  "sidepanel.empty.newChat": "New task",
  "sidepanel.empty.openHistory": "Open from History",
  // Session drawer
  "sidepanel.sessions.title": "Recent tasks",
  "sidepanel.sessions.empty": "No sessions yet. Send a message to start one.",
  "sidepanel.sessions.dialogAria": "Session history",
  "sidepanel.sessions.close": "Close",
  "sidepanel.sessions.openAsTab": "Open as tab",
  "sidepanel.sessions.rename": "Rename",
  "sidepanel.sessions.deletePermanently": "Remove from Amiba",
  "sidepanel.sessions.save": "Save",
  "sidepanel.sessions.cancel": "Cancel",
  "sidepanel.sessions.newChatTitle": "New task",
  "sidepanel.sessions.deleteConfirm":
    'Remove "{title}" from Amiba? DSH keeps the canonical session event log; this only hides the task from Amiba history.',
  "sidepanel.sessions.selected": "{count} selected",
  "sidepanel.sessions.select": "Select tasks",
  "sidepanel.sessions.archive": "Archive",
  "sidepanel.sessions.unarchive": "Unarchive",
  "sidepanel.sessions.active": "Active",
  "sidepanel.sessions.archived": "Archived",
  "sidepanel.sessions.branch": "Create branch",
  "sidepanel.sessions.export": "Export",
  "sidepanel.sessions.more": "More task actions",
  "sidepanel.sessions.bulkDeleteConfirm":
    "Remove {count} selected tasks from Amiba? DSH keeps their canonical event logs.",
  "sidepanel.sessions.group.today": "Today",
  "sidepanel.sessions.group.yesterday": "Yesterday",
  "sidepanel.sessions.group.earlierWeek": "Earlier this week",
  "sidepanel.sessions.group.thisMonth": "This month",
  "sidepanel.sessions.group.older": "Older",
  "sidepanel.sessions.group.unbound": "Independent tasks",
  // Channel-scoped section label: ``{name} chats`` — used for both the
  // local "Local chats" section and remote channel sections ("Feishu
  // chats", "Telegram chats", …). Single template keeps section
  // labels uniform across origins.
  "sidepanel.sessions.group.channelChats": "{name} chats",

  // Session history and DSH scheduled runs
  "sidepanel.sessions.history.empty": "No chats or scheduled runs yet.",
  "sidepanel.sessions.layout.menu": "Display mode",
  "sidepanel.sessions.layout.timeline": "All by time",
  "sidepanel.sessions.layout.grouped": "Group chats by workspace",
  "sidepanel.sessions.showMore": "Show more",
  "sidepanel.sessions.unread": "Unread update",
  "sidepanel.sessions.running": "Running",
  "sidepanel.sessions.failed": "Run failed",
  "sidepanel.sessions.activityBar.aria": "Sidebar views",

  // New tab
  "newtab.greeting": "What can I help with?",
  "newtab.subtitle":
    "Search the web, read a page, work with project files, run commands, or schedule work — just tell me what you need.",
  // Typewriter cycle in the new-tab composer — keep each line short
  // enough to fit on one line at the default composer width (~640px)
  // and concrete enough to suggest a real capability rather than just
  // "ask me anything".
  "newtab.placeholder.example.1": "Summarise the changes in this project",
  "newtab.placeholder.example.2": "Translate this paragraph to Chinese…",
  "newtab.placeholder.example.3": "Summarise this web page",
  "newtab.placeholder.example.4": "Latest AI news from the Valley",
  "newtab.placeholder.example.5": "Run the tests and fix what fails",
  "newtab.send.tooltip": "Send (Enter)",
  "workspace.openFolder": "Open folder",
  "workspace.context": "Execution context",
  "workspace.changeFolder": "Change workspace folder",
  "workspace.clearFolder": "Clear workspace folder",
  "workspace.pickerFailed": "Couldn't open that folder: {error}",
  "workspace.errorTitle": "Workspace unavailable",
  "sidepanel.context.from": "From",
  "sidepanel.context.dismissSource": "Dismiss source context",
  "newtab.openOptions": "Open Amiba options",

  // Wallpaper
  "newtab.wallpaper.cycle": "Next wallpaper",

  // Chat tab
  "chat.goHome": "Back to home",
  "chat.newChat": "New task",
  "chat.openOptions": "Open Amiba options",
  "chat.search": "Search",
  "chat.collapseSidebar": "Hide sidebar",
  "chat.expandSidebar": "Show sidebar",
  "chat.settings": "Settings",
  "commandPalette.description":
    "Search conversations or run common app commands.",
  "chat.resizeSidebar": "Resize sidebar",
  "chat.untitled": "Untitled chat",
  "chat.rename": "Rename",
  "chat.delete": "Remove",
  "chat.width.label": "Message column width",
  "chat.width.narrow": "Narrow",
  "chat.width.medium": "Medium",
  "chat.width.full": "Full",
  "chat.loadingSessions": "Loading sessions…",
  "chat.noMatches": "No matches.",
  "chat.noSessions": "No saved sessions yet.",
  "commandPalette.placeholder": "Search tasks or run commands",
  "commandPalette.empty": "No results",
  "commandPalette.group.recommended": "Recommended",
  "commandPalette.group.conversations": "Tasks",
  "commandPalette.cmd.newChat": "New Task",

  // ── Channels (multi-platform sessions) ──
  // ``channels.local`` is the label for every "this machine" session
  // — desktop main window and Quick-Ask. Plugin-owned transports are
  // represented generically; transport identity remains in DSH.
  "channels.local": "Local",
  "channels.unknown": "Other",

  "sidepanel.clarify.customAnswer": "Type another answer",
  "sidepanel.clarify.collapse": "Collapse",
  "sidepanel.clarify.expand": "Expand",
  "sidepanel.clarify.sendFailed": "Unable to send your answer.",
  "sidepanel.clarify.prev": "Previous",
  "sidepanel.clarify.next": "Next",
  "sidepanel.clarify.skip": "Skip",
  "sidepanel.clarify.skipHint": "Leave this one unanswered and move on",
  "sidepanel.clarify.submit": "Submit",
  "sidepanel.clarify.dismiss": "Not now",
  "sidepanel.clarify.dismissHint":
    "Leave all of these unanswered and let the agent continue",
  "sidepanel.clarify.unanswered": "Pick an option or type an answer.",
  "sidepanel.clarify.incomplete": "This one still needs an answer.",
  "sidepanel.clarify.recommended": "Recommended",
  "sidepanel.clarify.plan.header": "Review this plan",
  "sidepanel.clarify.plan.approve": "Approve",
  "sidepanel.clarify.plan.decline": "Refuse",
  "sidepanel.clarify.plan.discuss": "Chat about it",
} as const;

/** Every key this package's own copy defines. */
export type UiMessageKey = keyof typeof en;
/** Both-language parity, compile-enforced: `zh-CN.ts` is typed as this. */
export type UiMessages = Record<UiMessageKey, string>;
