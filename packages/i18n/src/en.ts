/**
 * English message catalog.
 *
 * Keys use dot-notation grouped by surface (options.*, sidepanel.*, etc.).
 * Use `{name}` placeholders for interpolation — see `t()` in `./index.ts`.
 *
 * To add a string:
 *   1. Add the key here.
 *   2. Add the same key to `zh-CN.ts` (TypeScript enforces this).
 *   3. Use `t("your.key")` in components via `useT()`.
 */
export const en = {
  // Generic
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.close": "Close",
  "common.refresh": "Refresh",
  "common.confirm": "Confirm",
  "common.loading": "Loading…",
  "common.saving": "Saving…",
  "common.installing": "Installing…",
  "common.error": "Error",
  "common.enabled": "Enabled",
  "common.disabled": "Disabled",
  "common.on": "On",
  "common.off": "Off",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.retry": "Retry",
  "common.all": "All",
  "common.untitled": "Untitled",

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
  "sidepanel.runError.voice.title": "Voice input is unavailable",
  "sidepanel.runError.voice.action": "Check voice settings",
  "sidepanel.runError.runtime.title": "The run couldn't continue",
  "sidepanel.runError.runtime.action": "View error logs",

  // Workspace inspector
  "workspacePane.title": "Workbench",
  "workspacePane.open": "Open workbench",
  "workspacePane.collapse": "Collapse workbench",
  "workspacePane.resize": "Resize workbench",
  "workspacePane.pin": "Keep this tab open",
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
  "workspacePane.currentTurn": "Current turn",
  "workspacePane.toolChange": "Tool change",
  "workspacePane.noDiff": "No reviewable diff was returned.",
  "workspacePane.unmodifiedLines": "{count} unmodified lines",
  "workspacePane.moreUnmodifiedLines": "{count} more unmodified lines",
  "workspacePane.contextUnavailable": "Full file context is unavailable",
  "workspacePane.openFile": "Open file",
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
  "workspacePane.collaboration": "Collaboration",
  "workspacePane.taskCount": "{count} tasks",
  "workspacePane.copyCode": "Copy code",
  "workspacePane.copyOutput": "Copy output",
  "workspacePane.copyWorkingDirectory": "Copy working directory",
  "workspacePane.copyDiff": "Copy diff",

  // App shell
  "app.title": "Amiba",
  "app.subtitle": "Extension console",
  "app.initializing": "Waking your local agent",
  "app.initError":
    "Couldn't start the local service. Make sure Hermes is installed and try again.",
  "app.initRetry": "Retry",

  // Options nav
  "options.nav.appearance": "Appearance",
  "options.nav.shortcuts": "Shortcuts",
  "options.nav.scripts": "Userscripts",
  "options.nav.models": "Models",
  "options.nav.agents": "Agent presets",
  "options.nav.skills": "Skills",
  "options.nav.memory": "Memory",
  "options.nav.cron": "Automation",
  "options.nav.status": "Status",
  "options.nav.logs": "Logs",
  "options.nav.voice": "Voice",
  "options.nav.extensions": "Extension management",
  "options.nav.plugins": "Plugins",
  "options.nav.mentionSources": "Mention Sources",
  "options.nav.section.general": "General",
  "options.nav.section.agent": "Assistant",
  "options.nav.section.advanced": "Advanced",
  "options.nav.section.models": "Models",
  "options.nav.section.diagnostics": "Diagnostics",
  "options.nav.section.extensions": "Extensions",

  // Agent profiles
  "options.agents.title": "Agent presets",
  "options.agents.profiles": "Agent presets",
  "options.agents.active": "Default task preset",
  "options.agents.defaultShort": "Default",
  "options.agents.setActive": "Make default task preset",
  "options.agents.create": "New agent preset",
  "options.agents.rename": "Rename agent preset",
  "options.agents.name": "Preset name",
  "options.agents.startFrom": "Start from",
  "options.agents.fresh": "Blank preset",
  "options.agents.noDescription": "No description",
  "options.agents.customEmptyTitle": "No independent agent presets",
  "options.agents.customEmptyDescription":
    "Assistant pages manage the default configuration. Create an agent here when it needs its own behavior, models, or skills.",
  "options.agents.cloneDefault": "Assistant default configuration",
  "options.agents.empty": "No agent presets",
  "options.agents.section.behavior": "Behavior & identity",
  "options.agents.section.models": "Models & services",
  "options.agents.role.title": "Description",
  "options.agents.role.description":
    "A short description shown when choosing who should run a task.",
  "options.agents.role.placeholder":
    "For example: investigates sources and verifies claims.",
  "options.agents.soul.title": "Behavior and principles",
  "options.agents.soul.description":
    "Durable identity and working principles; the default response mode shapes everyday expression and tasks can still override it.",
  "options.agents.soul.placeholder":
    "Describe how this agent should think, work, and communicate…",
  "options.agents.personality.title": "Response modes",
  "options.agents.personality.description":
    "Manage this agent's default work and expression mode; individual tasks can still switch temporarily.",
  "options.agents.personality.defaultLabel": "Default response mode",
  "options.agents.personality.defaultDescription":
    "Used by new tasks; a composer selection overrides only the current task.",
  "options.agents.personality.defaultNone": "No response mode",
  "options.agents.personality.defaultBadge": "Default",
  "options.agents.personality.create": "New response mode",
  "options.agents.personality.edit": "Edit response mode",
  "options.agents.personality.name": "Mode name",
  "options.agents.personality.namePlaceholder": "For example: Fact checker",
  "options.agents.personality.nameExists": "That name already exists.",
  "options.agents.personality.summary": "Purpose",
  "options.agents.personality.summaryPlaceholder":
    "For example: verify key claims and cite sources.",
  "options.agents.personality.instruction": "Behavior instruction",
  "options.agents.personality.instructionPlaceholder":
    "Describe how this mode should think, work, and respond…",
  "options.agents.personality.tone": "Tone",
  "options.agents.personality.tonePlaceholder": "For example: calm, direct",
  "options.agents.personality.style": "Response style",
  "options.agents.personality.stylePlaceholder":
    "For example: conclusion before evidence",
  "options.agents.personality.builtin": "Built in",
  "options.agents.personality.overridden": "Adjusted",
  "options.agents.personality.reset": "Restore built-in",
  "options.agents.personality.duplicate": "Duplicate",
  "options.agents.personality.deleteConfirm":
    "Are you sure you want to {action} “{name}”?",
  "options.agents.personality.loadFailed": "Couldn't load response modes",
  "options.agents.personality.saveFailed": "Couldn't save the response mode",
  "options.agents.personality.selectFailed":
    "Couldn't set the default response mode",
  "options.agents.personality.deleteFailed":
    "Couldn't remove the response mode",
  "options.agents.deleteConfirm": "Delete “{name}” and its preset data?",
  "options.agents.loadFailed": "Couldn't load agent presets",
  "options.agents.soulLoadFailed": "Couldn't load SOUL.md",
  "options.agents.saveFailed": "Couldn't save the preset",
  "options.agents.activateFailed": "Couldn't change the default preset",
  "options.agents.createFailed": "Couldn't create the preset",
  "options.agents.renameFailed": "Couldn't rename the preset",
  "options.agents.deleteFailed": "Couldn't delete the preset",
  "options.agents.modelSaveFailed": "Couldn't save the preset model",

  // Skills
  "options.skills.all": "All",
  "options.skills.categories": "Categories",
  "options.skills.totalEnabled": "{total} skills · {enabled} enabled",
  "options.skills.search": "Search name, description, tag, or category…",
  "options.skills.clearSearch": "Clear search",
  "options.skills.clearFilters": "Clear",
  "options.skills.noMatches": "No skills match the current filters.",
  "options.skills.dismissError": "Dismiss error",
  "options.skills.uncategorized": "Uncategorized",
  "options.skills.enabled": "Enabled",
  "options.skills.disabled": "Disabled",
  "options.skills.enabledHint": "Loaded into this agent preset",
  "options.skills.disabledHint": "Listed in config.yaml/skills.disabled",
  "options.skills.toggleOn": "Click to disable this skill",
  "options.skills.toggleOff": "Click to enable this skill",
  "options.skills.loadFailed": "Couldn't load skills",
  "options.skills.toggleFailed": "Couldn't change skill state",
  "options.skills.origin.bundled": "Bundled",
  "options.skills.origin.hub": "Skill Hub",
  "options.skills.origin.agent": "Agent-authored",
  "options.skills.origin.manual": "Manual",
  "options.skills.origin.external": "External",
  "options.skills.origin.bundledHint": "Shipped with Hermes Agent",
  "options.skills.origin.hubHint": "Installed from the Hermes Skill Hub",
  "options.skills.origin.agentHint": "Created by an agent",
  "options.skills.origin.manualHint":
    "Added manually to the Hermes skills directory",
  "options.skills.origin.externalHint":
    "Loaded from an external skills directory in config.yaml",
  "options.skills.files": "Files ({count})",
  "options.skills.filesTruncated": "showing the first {count}",
  "options.skills.loading": "Loading…",
  "options.skills.reading": "Reading…",
  "options.skills.noFiles": "No files",
  "options.skills.selectFile": "Select a file on the left to view its contents",
  "options.skills.binaryFile": "Binary file · {size}",
  "options.skills.fileTooLarge": "File is too large to preview ({size})",

  // Task agent picker
  "sidepanel.agentPicker.label": "Choose agent",
  "sidepanel.agentPicker.description":
    "Choose the Hermes Profile responsible for this task.",
  "sidepanel.agentPicker.search": "Search agents…",
  "sidepanel.agentPicker.empty": "No matching agents",
  "sidepanel.agentPicker.loadFailed": "Couldn't load agents",
  "sidepanel.agentPicker.locked":
    "This agent is bound to the task; start a new task to switch",
  "sidepanel.agentPicker.executionIdentity": "Execution identity",
  "sidepanel.agentPicker.executionIdentityDescription":
    "Choose an agent and response mode for this task.",
  "sidepanel.agentPicker.agent": "Agent",
  "sidepanel.agentPicker.personality": "Response mode",
  "sidepanel.agentPicker.personalityDescription":
    "Changes the expression style for this task only.",
  "sidepanel.agentPicker.personalityDefault": "Follow agent",
  "sidepanel.agentPicker.personalityDefaultDescription":
    "Use this agent's configured default response mode and working principles.",

  // Extensions settings page
  "options.extensions.title": "Extension management",
  "options.extensions.subtitle": "App extensions you added to Amiba.",
  "options.extensions.status.loaded": "Loaded",
  "options.extensions.status.failed": "Failed",
  "options.extensions.status.incompatible": "Incompatible",
  "options.extensions.showError": "Show error",
  "options.extensions.showDetails": "Show details",
  "options.extensions.addLocal": "Add local extension…",
  "options.extensions.source.marketplace": "Marketplace",
  "options.extensions.source.local": "Local",
  "options.extensions.refresh": "Refresh",
  "options.extensions.reload": "Reload",
  "options.extensions.uninstall": "Uninstall",
  "options.extensions.uninstall.confirm.title": "Uninstall extension?",
  "options.extensions.uninstall.confirm.body":
    "{name} will be removed from this app. The folder at <userData>/extensions/{id}/ will be deleted.",
  "options.extensions.uninstall.confirm.body.local":
    "Only removes {name} from the registry. The source folder at {path} is not touched.",
  "options.extensions.sideload.error": "Could not add local extension: {error}",
  "options.extensions.empty":
    "No extensions installed yet. Add a local extension to get started.",
  "options.extensions.tab.installed": "Installed",
  "options.extensions.tab.browse": "Browse",
  "options.extensions.browse.loading": "Loading marketplace…",
  "options.extensions.browse.empty": "Marketplace is empty.",
  "options.extensions.browse.error": "Could not load marketplace: {error}",
  "options.extensions.browse.install": "Install",
  "options.extensions.browse.installed": "Installed",
  "options.extensions.browse.installing": "Installing…",
  "options.extensions.browse.installFailed": "Install failed: {error}",
  "options.extensions.browse.indexUrl": "Index: {url}",
  "options.plugins.heading": "Plugins",
  "options.plugins.subtitle":
    "Agent plugins you added. Enable, disable or remove them independently.",
  "options.plugins.loading": "Loading plugins…",
  "options.plugins.error": "Couldn't load plugins: {error}",
  "options.plugins.empty": "No user-added plugins.",
  "options.plugins.group.yours": "Your plugins",
  "options.plugins.group.bundled": "Bundled ({count})",
  "options.plugins.restartHint": "Restart Hermes to apply plugin changes.",
  "options.plugins.toggleError": "Couldn't change plugin: {error}",

  // Mention sources — pluggable @-mention sources for the composer
  "options.mentionSources.title":
    "Sources you can @-mention in chat (e.g. Feishu docs). Each is a git repo; install by URL, update pulls latest. Not a hermes plugin — agent actions/triggers belong to hermes plugins/mcp/platforms.",
  "options.mentionSources.installPlaceholder":
    "git URL, e.g. https://github.com/you/amiba-source-notion",
  "options.mentionSources.install": "Install",
  "options.mentionSources.installing": "Installing…",
  "options.mentionSources.loading": "Loading sources…",
  "options.mentionSources.error": "Couldn't reach the backplane.",
  "options.mentionSources.empty":
    "No mention sources installed yet. Paste a git URL above to add one.",
  "options.mentionSources.update": "Update",
  "options.mentionSources.reload": "Reload",
  "options.mentionSources.remove": "Remove",
  "options.mentionSources.local": "local",
  "options.mentionSources.localHint":
    "Editable symlink → {path} (edit the repo; Reload picks it up)",
  "options.mentionSources.legacy": "legacy",
  "options.mentionSources.unavailable": "unavailable",
  "options.mentionSources.noSearch": "no search",
  "options.mentionSources.noSearchHint":
    "Imported but exposes no `search` — its @-mentions return nothing. Check its __init__.py re-exports `search`.",
  "options.mentionSources.removeConfirm":
    'Remove the "{name}" mention source? This deletes its folder.',
  "options.mentionSources.installError": "Install failed: {error}",
  "options.mentionSources.updateError": "Update failed: {error}",
  "options.mentionSources.removeError": "Remove failed: {error}",
  "options.mentionSources.loadWarning":
    "{name} installed, but it has no search capability ({warning}).",
  "options.plugins.uninstallAction": "Uninstall",
  "options.plugins.uninstallConfirm":
    'Uninstall "{name}"? It fully unloads after a Hermes restart. This can\'t be undone.',
  "options.plugins.uninstallError": "Couldn't uninstall: {error}",

  // Featured features — plugins promoted to a first-class Settings surface
  "options.feature.enableLabel": "Enable",
  "options.feature.stateOn": "Enabled — applies after restarting Amiba.",
  "options.feature.stateOff": "Disabled.",
  "options.feature.notInstalled":
    "The browser component for connecting the current tab isn't installed yet.",
  "options.feature.installAction": "Install connection",
  "options.feature.restartHint": "Restart Amiba to apply this change.",
  "options.feature.installPrompt":
    'Please install the Hermes plugin that powers the "{name}" feature for me by running `hermes plugins install {ref}`. When it\'s done, tell me whether Hermes needs a restart to start using it.',
  "options.feature.agentSourceApp": "Settings",
  "options.feature.backplaneError": "Couldn't read this feature's status.",
  "options.feature.browser.title": "Browser",
  "options.feature.browser.subtitle":
    "Let Amiba see and control your browser through the companion Chrome extension.",
  "options.feature.browser.how.title": "How it works",
  "options.feature.browser.how.body":
    "Once connected, the agent can read and operate tabs you already have open, and only uses this access when a task needs it.",

  // Composer voice input
  "composer.voice.startRecording": "Record voice message",
  "composer.voice.stopRecording": "Stop recording",
  "composer.voice.transcribing": "Transcribing…",
  "composer.voice.permissionDenied":
    "Microphone access was denied. Allow it in your OS settings to use voice input.",
  "composer.voice.unsupported":
    "Voice input is not supported in this environment.",
  "composer.voice.transcribeFailed": "Voice transcription failed: {error}",
  "composer.mention.typeToSearch": "Type a keyword to search",
  "composer.mention.noResults": "No results",

  // Voice settings page
  "options.voice.title": "Voice input",
  "options.voice.description":
    "Configure the composer microphone button and the speech-to-text engine.",
  "options.voice.enable.label": "Enable voice input",
  "options.voice.enable.help":
    "Show the microphone button in the chat composer.",
  "options.voice.autoSend.label": "Auto-send after transcribe",
  "options.voice.autoSend.help":
    "If off, the transcript lands in the composer and waits for you to hit send.",
  "options.voice.device.label": "Microphone device",
  "options.voice.device.system": "System default",
  "options.voice.device.refresh": "Refresh devices",
  "options.voice.test.label": "Test microphone",
  "options.voice.test.start": "Record 2-second test",
  "options.voice.test.recording": "Listening…",
  "options.voice.test.transcribing": "Transcribing test clip…",
  "options.voice.test.loadingModel":
    "First run — downloading the local model (~150 MB), please hang on…",
  "options.voice.test.timeout":
    "Request timed out. The model may still be downloading or loading — try again in a moment.",
  "options.voice.test.success": "Recognised: {text}",
  "options.voice.test.empty":
    "Recording captured, but no speech was recognised.",
  "options.voice.test.failed": "Test failed: {error}",

  // Provider picker
  "options.voice.provider.label": "Provider",
  "options.voice.provider.local": "Local (faster-whisper, free)",
  "options.voice.provider.groq": "Groq",
  "options.voice.provider.openai": "OpenAI",
  "options.voice.provider.mistral": "Mistral Voxtral",
  "options.voice.provider.elevenlabs": "ElevenLabs Scribe",
  "newtab.dropOverlay": "Drop files to attach",
  "options.voice.localModel.label": "Local model size",
  "options.voice.localModel.notDownloaded":
    "{model} model isn't downloaded yet (~{size})",
  "options.voice.localModel.ready": "{model} model is ready",
  "options.voice.localModel.download": "Download",
  "options.voice.localModel.downloading": "Downloading {model} model…",
  "options.voice.localModel.downloadFailed": "Download failed: {error}",
  "options.voice.localModel.retry": "Retry",
  "options.voice.localModel.help":
    "Larger models are more accurate but slower. Recommended: base.",

  // API-key editor
  "options.voice.apiKey.label": "API key",
  "options.voice.apiKey.placeholder": "Paste your provider API key",
  "options.voice.apiKey.placeholderReplace":
    "Enter a new key to replace the saved one",
  "options.voice.apiKey.set": "Key is set",
  "options.voice.apiKey.unset": "Not set",
  "options.voice.apiKey.clear": "Clear",
  "options.voice.apiKey.confirmClear": "Confirm clear",
  "options.voice.apiKey.help":
    "Stored in ~/.hermes/.env. Empty input is ignored; use Clear to remove a saved key.",

  // Status (loading / error)
  "options.voice.status.loading": "Reading STT config…",
  "options.voice.status.error": "Couldn't reach the backplane: {error}",
  "options.voice.status.retry": "Retry",

  // Preference page
  "options.preference.subtitle": "Extension UI and behavior",
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

  // First-run onboarding wizard
  "onboarding.title": "Amiba",
  "onboarding.tagline":
    "A native desktop client for Hermes Agent.\nDouble-tap ⌘ from anywhere to summon a chat — Amiba stays within reach.",
  "onboarding.subtitle":
    "We'll install Hermes, load the plugins it needs, and boot the local service for you.\nAbout 5–10 minutes from here — nothing to prepare on your end.",
  "onboarding.step.install": "Install core",
  "onboarding.step.plugins": "Load plugins",
  "onboarding.step.backplane": "Start service",
  "onboarding.step.ready": "Ready",
  "onboarding.detect.checking": "Checking your environment…",
  "onboarding.install.manualTitle": "Rather run it yourself in a terminal?",
  "onboarding.install.manualHint":
    "Run these commands in your terminal one by one, then come back and tap Re-check.",
  "onboarding.install.manualStep.install": "1. Install Hermes core",
  "onboarding.install.manualStep.plugin": "{n}. Load plugin {id}",
  "onboarding.ready.title": "You're all set",
  "onboarding.ready.subtitle": "Heading into Amiba…",
  "onboarding.error.install":
    "Install failed — the terminal below has the details.",
  "onboarding.error.plugin": "Failed to load a plugin",
  "onboarding.error.backplane": "Local service didn't come up in time",
  "onboarding.configure.errorTitle": "Setup didn't finish",
  "onboarding.configure.errorHint":
    "Hermes is installed and ready — only its local service couldn't start. Try again, or check the log.",
  "onboarding.configure.retry": "Retry",
  "onboarding.action.copy": "Copy command",
  "onboarding.action.copied": "Copied",
  "onboarding.log.title": "Live progress",
  "onboarding.log.empty": "(no output yet)",
  "onboarding.summary.action.install": "One-click install",
  "onboarding.summary.action.recheck": "Re-check",
  "onboarding.running.caption":
    "Working on {step}. The terminal below shows live progress — some prompts (e.g. API keys) need you to type a reply right there.",
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
  "options.preference.language": "Language",
  "options.preference.language.auto": "Auto",
  "options.preference.language.en": "English",
  "options.preference.language.zh-CN": "简体中文",
  "options.preference.newtab.wallpaper.label": "Daily wallpaper",

  // Userscripts
  "options.scripts.title": "Userscripts",
  "options.scripts.subtitle": "Create, install, and manage userscripts",
  "options.scripts.new": "New script",
  "options.scripts.installFromUrl": "Install from URL",
  "options.scripts.installDialog.title": "Install userscript from URL",
  "options.scripts.installDialog.label": "Script URL",
  "options.scripts.installDialog.install": "Install",
  "options.scripts.empty":
    "No userscripts installed yet. Use the buttons above to create or import one.",
  "options.scripts.removeConfirm":
    "Remove this userscript? This action can't be undone.",
  "options.scripts.editor.newTitle": "New userscript",
  "options.scripts.editor.editTitle": "Edit: {name}",
  "options.scripts.runAt": "Run at: {runAt}",
  "options.scripts.match": "Match: {match}",
  "options.scripts.version": "v{version}",
  "options.scripts.updatedAt": "Updated {time}",
  "options.scripts.lastError": "Last error",
  "options.scripts.errorBadge": "error",
  "options.scripts.noMatch": "(no @match)",
  "options.scripts.action.edit": "Edit",
  "options.scripts.action.remove": "Remove",
  "options.scripts.editor.save": "Save",
  "options.scripts.editor.cancel": "Cancel",
  "options.scripts.editor.placeholder":
    "// ==UserScript==\n// @name        My script\n// @match       https://example.com/*\n// @run-at      document-end\n// ==/UserScript==\n",

  // Gateway settings
  "options.gateway.baseUrl": "Gateway base URL",
  "options.gateway.baseUrl.placeholder": "http://127.0.0.1:8642/v1",
  "options.gateway.baseUrl.desc":
    "The gateway listens on this URL. Override it if you ran `hermes chat` on a different port or host.",
  "options.gateway.test": "Test connection",
  "options.gateway.testing": "Testing…",
  "options.gateway.test.ok": "Connected. Bridge is reachable.",
  "options.gateway.test.fail": "Could not reach the bridge: {error}",
  "options.gateway.startHint":
    "Gateway not running? Start it with `hermes chat` from the Hermes CLI.",
  "options.gateway.section.chat": "Side panel chat",
  "options.gateway.model.label": "Chat model id",
  "options.gateway.model.fromGateway": "From gateway",
  "options.gateway.model.fromGateway.tooltip":
    "List models the gateway currently exposes",
  "options.gateway.model.noModels": "Gateway returned no models.",
  "options.gateway.save": "Save",
  "options.gateway.saved": "Saved.",
  "options.gateway.backplaneKey.title": "Backplane access",
  "options.gateway.backplaneKey.label": "Access key (optional)",
  "options.gateway.backplaneKey.placeholder":
    "leave empty unless you've set AMIBA_BACKPLANE_KEY",
  "options.gateway.backplaneKey.help":
    "Usually leave empty. If you want to require auth, set AMIBA_BACKPLANE_KEY in ~/.hermes/.env, restart Hermes, then paste the same value here.",
  "options.gateway.bridge.title": "Bridge",
  "options.gateway.bridge.url.label": "Bridge URL",
  "options.gateway.bridge.url.help":
    "Leave as default. Only change this if you've moved the bridge to a different port on the Hermes side.",

  // Memory settings
  "options.memory.title": "Memory",
  "options.memory.subtitle":
    "Hermes Agent's persistent memory (read-only view)",
  "options.memory.subtitle.tooltip": "$HERMES_HOME/memories/{MEMORY,USER}.md",
  "options.memory.empty": "(No memory entries yet)",
  "options.memory.refresh": "Refresh",
  "options.memory.failedToLoad": "Failed to load",
  "options.memory.chars": "{count} / {limit} chars",
  "options.memory.entries": "{count} entries",
  "options.memory.charsLen": "{count} chars",
  "options.memory.target.memory": "MEMORY.md",
  "options.memory.target.user": "USER.md",
  "options.memory.desc.memory":
    "Hermes Agent's own observations (environment facts, project conventions, tool quirks, etc.).",
  "options.memory.desc.user":
    "User preferences and collaboration habits noted by Hermes Agent.",
  "options.memory.flagTooltip":
    "Hermes safety-scan flag: {flag}\nThe same rules block entries before MEMORY.md is injected into the system prompt",

  // Models / Hermes model config
  "options.models.title": "Models",
  "options.models.subtitle":
    "Which providers and models Amiba uses for chat, embedding, and tool calls.",
  "options.models.catalog.loading": "Loading…",
  "options.models.catalog.ready": "Catalog ready",
  "options.models.catalog.unavailable": "Catalog unavailable",
  "options.models.catalog.updatedAt": "Catalog {time}",
  "options.models.refreshCatalog": "Refresh catalog",
  "options.models.loadingSettings": "Loading settings…",
  "options.models.config.navTitle": "Models & services",
  "options.models.connection.navTitle": "Connection",
  "options.models.display.navTitle": "Shown in chat",
  "options.models.display.navDescription": "Choose models for the input bar",
  "options.models.display.title": "Service providers",
  "options.models.providers.sectionTitle": "Service providers",
  "options.models.display.search": "Search providers or models…",
  "options.models.display.empty": "No matching providers or models.",
  "options.models.display.source.config": "Hermes config",
  "options.models.display.source.saved": "Saved here",
  "options.models.display.source.detected": "Credential detected",
  "options.models.display.source.available": "Not connected",
  "options.models.display.current": "Current",
  "options.models.display.currentDescription":
    "This is the active main provider. Switch models before hiding it.",
  "options.models.display.currentModel": "Current main model",
  "options.models.display.availableModels": "{count} models",
  "options.models.display.providerToggle": "Show {name} in model menus",
  "options.models.display.configureProvider": "Configure {name}",
  "options.models.display.modelToggle": "Show {name} in model menus",
  "options.models.display.noModels":
    "No models are currently available from this provider.",
  "options.models.display.saveFailed":
    "Could not save the model visibility preference.",
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
  "options.models.details.referenceNote":
    "Model information references {source}.",
  "options.models.details.noSupplemental":
    "Hermes or the provider did not supply an extended profile, and no community catalog entry matched this model.",
  "options.models.config.defaultsTitle": "Model assignments",
  "options.models.config.mainModel": "Main model",
  "options.models.config.main": "Default model",
  "options.models.config.mainDescription":
    "Used whenever a task has no dedicated override.",
  "options.models.config.mainUnset": "Not set — choose a model",
  "options.models.config.auxiliaryModels": "Auxiliary models",
  "options.models.config.useMainModel": "Use the main model",
  "options.models.config.useMainModelDescription":
    "Do not assign a separate model; always follow the current main model.",
  "options.models.config.configuredCount": "{count} of {total} configured",
  "options.models.config.auxiliaryUnavailable":
    "Auxiliary model configuration is unavailable because the bridge is not connected.",
  "options.models.config.saved": "Saved",
  "options.models.config.clear": "Clear",
  "options.models.config.select": "Choose",
  "options.models.config.search": "Search model id, provider, or description…",
  "options.models.config.searchForTask": "Search models for {task}…",
  "options.models.config.pickerTitle": "Choose a model for {task}",
  "options.models.config.pickerDescription":
    "Search configured providers and assign a model to this task.",
  "options.models.config.noMatchingModels": "No matching models.",
  "options.models.config.readMainFailed": "Could not read the main model.",
  "options.models.config.setMainFailed": "Could not set the main model.",
  "options.models.config.setCustomFailed":
    "Could not set the custom main model.",
  "options.models.config.saveFailed": "Could not save the model assignment.",
  "options.models.config.clearFailed": "Could not clear the model assignment.",
  "options.models.config.context": "Context",
  "options.models.config.contextOverride": "Context (override)",
  "options.models.config.contextOverrideHint":
    "config.yaml override: {configured}\nAuto-detected: {detected}",
  "options.models.config.contextDetectedHint":
    "Auto-detected from agent model metadata",
  "options.models.config.unknown": "unknown",
  "options.models.config.modelFamilyHint": "Model family from models.dev",
  "options.models.config.capability.vision": "Vision",
  "options.models.config.capability.visionHint":
    "Supports image input according to models.dev",
  "options.models.config.capability.reasoning": "Reasoning",
  "options.models.config.capability.reasoningHint":
    "Supports reasoning tokens or extended thinking",
  "options.models.config.capability.tools": "Tools",
  "options.models.config.capability.toolsHint":
    "Supports OpenAI-style function calling",
  "options.models.config.capability.output": "Output {count}",
  "options.models.config.capability.outputHint":
    "Maximum output of {count} tokens per call",
  "options.models.config.slot.vision": "Vision",
  "options.models.config.slot.webExtract": "Web extraction",
  "options.models.config.slot.compression": "Context compression",
  "options.models.config.slot.sessionSearch": "Session search",
  "options.models.config.slot.skillsHub": "Skills hub",
  "options.models.config.slot.approval": "Approval",
  "options.models.config.slot.mcp": "MCP",
  "options.models.config.slot.titleGeneration": "Title generation",
  "options.models.provider.addCustom": "Add custom endpoint",
  "options.models.provider.customName": "Custom OpenAI-compatible endpoint",
  "options.models.provider.credentials": "Credentials",
  "options.models.provider.endpoint": "Endpoint: {url}",
  "options.models.provider.metadataPartial":
    "Provider metadata is only partially available. Make sure Hermes is installed and connected.",
  "options.models.provider.customDescription":
    "Use any OpenAI-compatible endpoint as the main model. Enter its model id and endpoint here.",
  "options.models.provider.customModel": "Model id",
  "options.models.provider.customModelPlaceholder":
    "e.g. gpt-4o, llama-3.3-70b",
  "options.models.provider.customEndpoint": "Endpoint URL",
  "options.models.provider.setDefault": "Set as main model",
  "options.models.provider.loadingCredentials": "Loading credentials…",
  "options.models.provider.credentialValue": "Credential",
  "options.models.provider.credentialPlaceholder": "Enter access credential",
  "options.models.provider.showCredential": "Show credential",
  "options.models.provider.hideCredential": "Hide credential",
  "options.models.provider.credentialActive": "In use",
  "options.models.provider.credentialConfigured": "Configured",
  "options.models.provider.credentialResolution":
    "Saving the current connection clears other mutually exclusive saved credentials and preserves shared endpoint settings.",
  "options.models.provider.connection.title": "Connection status",
  "options.models.provider.connection.details": "Connection details",
  "options.models.provider.connection.credentialSource": "Credential source",
  "options.models.provider.connection.reason": "Reason",
  "options.models.provider.connection.external": "External connection",
  "options.models.provider.connection.otherMethods": "Other detected methods",
  "options.models.provider.connection.detectedNotUsed":
    "Detected, not currently used",
  "options.models.provider.connection.githubIdentity": "GitHub identity",
  "options.models.provider.connection.copilotService": "Copilot service",
  "options.models.provider.connection.notDetected": "Not detected",
  "options.models.provider.connection.detected": "Identity credential detected",
  "options.models.provider.connection.required": "GitHub login required",
  "options.models.provider.connection.status.none": "Not connected",
  "options.models.provider.connection.status.detected": "Detected",
  "options.models.provider.connection.status.configured": "Configured",
  "options.models.provider.connection.status.verification_required":
    "Verification required",
  "options.models.provider.connection.status.verified": "Verified",
  "options.models.provider.connection.status.unavailable": "Unavailable",
  "options.models.provider.connection.scope.title": "Scope",
  "options.models.provider.connection.scope.profile": "This agent",
  "options.models.provider.connection.scope.shared": "Shared credential",
  "options.models.provider.connection.scope.system": "System login",
  "options.models.provider.connection.scope.none": "Setup required",
  "options.models.provider.service.status.not_applicable":
    "No separate verification",
  "options.models.provider.service.status.not_checked": "Not verified",
  "options.models.provider.service.status.verified": "Verified and available",
  "options.models.provider.service.status.unavailable": "Service unavailable",
  "options.models.provider.service.copilotHint":
    "The GitHub identity must be exchanged for Copilot service access",
  "options.models.provider.service.copilotDenied":
    "GitHub is signed in, but no usable Copilot service credential was issued",
  "options.models.provider.service.copilotUnsupportedToken":
    "The current GitHub credential type is not supported by the Copilot API",
  "options.models.provider.service.copilotVerificationFailed":
    "Service verification could not be completed. Try again later",
  "options.models.provider.method.anthropicApiKey": "Anthropic API Key",
  "options.models.provider.method.anthropicOauth": "Anthropic OAuth",
  "options.models.provider.method.claudeSetupToken": "Claude Setup Token",
  "options.models.provider.method.copilotToken": "Copilot GitHub Token",
  "options.models.provider.method.githubCliToken": "GitHub CLI Token",
  "options.models.provider.method.githubToken": "GitHub Token",
  "options.models.provider.method.claudeCode": "Claude Code login",
  "options.models.provider.method.githubCli": "GitHub CLI login",
  "options.models.provider.method.hermesOauth": "Hermes OAuth login",
  "options.models.provider.authHint.oauthDevice":
    "You can also sign in through Hermes' device authorization flow.",
  "options.models.provider.authHint.oauthExternal":
    "You can also use an external CLI login detected by Hermes.",
  "options.models.provider.authHint.externalProcess":
    "This service can also be supplied by an authenticated external process.",
  "options.models.provider.authHint.awsSdk":
    "Hermes also reads local AWS SDK configuration or IAM environment credentials.",
  "options.models.provider.authHint.copilot":
    "GitHub identity and Copilot service access are separate states. Copilot is usable only after service verification succeeds.",
  "options.models.provider.authHint.vertex":
    "Hermes also reads Google Cloud ADC or service-account configuration.",
  "options.models.provider.saveCredentials": "Save credentials",
  "options.models.provider.saved": "Saved",
  "options.models.provider.readCredentialsFailed":
    "Could not read provider credentials.",
  "options.models.provider.saveFailed": "Could not save provider credentials.",
  "options.models.provider.models": "Available models",
  "options.models.provider.refreshModels": "Refresh model list",
  "options.models.provider.loadingModels": "Loading models…",
  "options.models.provider.referenceList":
    "A reference list is shown. Save credentials and refresh to fetch the full list.",
  "options.models.provider.pricingHint":
    "Prices are USD per million tokens and may differ by route. Treat your provider bill as the source of truth.",
  "options.models.provider.noModels":
    "No models are available yet. Save the required credentials, then refresh this list.",
  "options.models.meta.context": "Context",
  "options.models.meta.contextCap": "Context cap",
  "options.models.meta.outputCap": "Output cap",
  "options.models.meta.tokens": "Tokens",
  "options.models.meta.input": "Input",
  "options.models.meta.output": "Output",
  "options.models.meta.inputPrice": "Input price",
  "options.models.meta.outputPrice": "Output price",
  "options.models.meta.pricing": "Pricing",
  "options.models.meta.pricingTier": "Pricing tier",
  "options.models.meta.modality": "Modality",
  "options.models.meta.parameters": "Parameters",
  "options.models.meta.capabilities": "Capabilities",
  "options.models.virtual.navTitle": "Multi-model collaboration",
  "options.models.virtual.moaTitle": "Multi-model collaboration",
  "options.models.virtual.virtualBadge": "Multi-model collaboration",
  "options.models.virtual.description":
    "Multi-model collaboration runs reference models in parallel, then asks an aggregator model to produce the answer.",
  "options.models.virtual.loading": "Loading multi-model collaboration…",
  "options.models.virtual.unavailable":
    "Multi-model collaboration configuration is unavailable.",
  "options.models.virtual.save": "Save preset",
  "options.models.virtual.saved": "Saved",
  "options.models.virtual.unsaved": "Unsaved",
  "options.models.virtual.saveFailed":
    "Could not save the multi-model collaboration configuration.",
  "options.models.virtual.status.ready": "Ready",
  "options.models.virtual.status.degraded": "Partially ready",
  "options.models.virtual.status.unavailable": "Unavailable",
  "options.models.virtual.status.disabled": "Disabled",
  "options.models.virtual.unavailableHint":
    "The aggregator model is not currently usable. Connect its service provider or choose another model before running this preset.",
  "options.models.virtual.degradedHint":
    "One or more reference models are unavailable. The aggregator is ready, but this preset cannot use its full reference set.",
  "options.models.virtual.preset": "Collaboration presets",
  "options.models.virtual.defaultPreset": "Default",
  "options.models.virtual.setDefault": "Set as default",
  "options.models.virtual.newPreset": "Preset name",
  "options.models.virtual.addPreset": "New preset",
  "options.models.virtual.renamePreset": "Rename preset",
  "options.models.virtual.renamePresetNamed": "Rename preset “{name}”",
  "options.models.virtual.copyPreset": "Duplicate preset",
  "options.models.virtual.copyName": "{name} copy",
  "options.models.virtual.copyNameIndexed": "{name} copy {number}",
  "options.models.virtual.presetActions": "Preset actions",
  "options.models.virtual.presetActionsNamed": "Manage preset “{name}”",
  "options.models.virtual.presetNameRequired": "Preset name cannot be empty.",
  "options.models.virtual.presetNameExists":
    "A preset with this name already exists.",
  "options.models.virtual.deletePreset": "Delete preset",
  "options.models.virtual.enabled": "Enabled",
  "options.models.virtual.enabledHint":
    "Enabled presets appear in the input-bar picker under Multi-model collaboration once the aggregator is usable.",
  "options.models.virtual.pipelineTitle": "Model pipeline",
  "options.models.virtual.pipelineDescription":
    "References analyze the request in parallel. The aggregator receives their output and acts as the final model.",
  "options.models.virtual.reference": "Reference {number}",
  "options.models.virtual.aggregator": "Aggregator",
  "options.models.virtual.parallel": "Parallel analysis, then aggregate",
  "options.models.virtual.addReference": "Add reference model",
  "options.models.virtual.removeReference": "Remove reference model",
  "options.models.virtual.referenceEnabledNamed": "Enable {name}",
  "options.models.virtual.slotSettingsNamed": "Execution settings for {name}",
  "options.models.virtual.reasoningEffort": "Reasoning effort",
  "options.models.virtual.reasoning.provider_default": "Use model default",
  "options.models.virtual.reasoning.none": "No reasoning",
  "options.models.virtual.reasoning.minimal": "Minimal",
  "options.models.virtual.reasoning.low": "Low",
  "options.models.virtual.reasoning.medium": "Medium",
  "options.models.virtual.reasoning.high": "High",
  "options.models.virtual.reasoning.xhigh": "Extra high",
  "options.models.virtual.reasoning.max": "Maximum",
  "options.models.virtual.reasoning.ultra": "Ultra",
  "options.models.virtual.referenceOutputLimit": "Per-model output cap",
  "options.models.virtual.inheritPresetOutputLimit": "Use preset cap",
  "options.models.virtual.advancedTitle": "Advanced",
  "options.models.virtual.fanout.label": "Advisor refresh",
  "options.models.virtual.fanout.userTurn": "Once per task",
  "options.models.virtual.fanout.perIteration": "Every execution step",
  "options.models.virtual.fanout.everyN": "Every {count} execution steps",
  "options.models.virtual.fanout.interval": "Refresh interval",
  "options.models.virtual.referenceMaxTokens": "Advisor output cap",
  "options.models.virtual.referenceMaxTokensValue": "Advisor output {count}",
  "options.models.virtual.referenceTimeout": "Advisor timeout (seconds)",
  "options.models.virtual.unlimited": "Unlimited",
  "options.models.virtual.inheritHermes": "Use Hermes default",
  "options.models.virtual.degradedPolicy": "When an advisor fails",
  "options.models.virtual.degraded.loud": "Show degraded state",
  "options.models.virtual.degraded.silent": "Continue silently",
  "options.models.virtual.privacyFilter": "Advisor redaction",
  "options.models.virtual.privacy.off": "Off",
  "options.models.virtual.privacy.display": "UI and diagnostic records",
  "options.models.virtual.privacy.full": "UI, records, and aggregator input",
  "options.models.virtual.providerDefault": "Provider default",
  "options.models.virtual.referenceTemperature": "Reference temperature",
  "options.models.virtual.referenceTemperatureHint":
    "Leave empty to use each model provider's default.",
  "options.models.virtual.aggregatorTemperature": "Aggregator temperature",
  "options.models.virtual.aggregatorTemperatureHint":
    "Leave empty to use the aggregator provider's default.",

  // Automation
  "options.cron.title": "Automation",
  "options.cron.pageTitle": "Automation",
  "options.cron.subtitle": "Tasks Hermes runs for you on a schedule",
  "options.cron.refresh": "Refresh",
  "options.cron.newJob": "New job",
  "options.cron.search": "Search scheduled tasks",
  "options.cron.search.empty": "No matching tasks",
  "options.cron.filter.label": "Filter scheduled tasks",
  "options.cron.filter.all": "All",
  "options.cron.filter.enabled": "Enabled",
  "options.cron.filter.paused": "Paused",
  "options.cron.loading": "Loading scheduled tasks…",
  "options.cron.empty.title": "No scheduled tasks yet",
  "options.cron.empty.description":
    "Create one to let Hermes handle recurring or time-based work.",
  "options.cron.form.create": "New automation",
  "options.cron.form.edit": "Edit automation",
  "options.cron.form.createAction": "Create",
  "options.cron.form.name": "Name",
  "options.cron.form.name.placeholder":
    "Optional — Hermes can derive it from the instructions",
  "options.cron.form.schedule": "Schedule",
  "options.cron.form.schedule.hint":
    "Cron expression, recurring duration, one-shot duration, or ISO time",
  "options.cron.form.prompt": "Instructions",
  "options.cron.form.prompt.placeholder":
    "Self-contained instructions Hermes should execute.",
  "options.cron.form.prompt.scriptPlaceholder":
    "Optional when running a script directly",
  "options.cron.form.execution": "Execution",
  "options.cron.form.model": "Model",
  "options.cron.form.skills": "Skills",
  "options.cron.form.skills.inherit": "No forced skills",
  "options.cron.form.skills.search": "Search skills…",
  "options.cron.form.workdir": "Working directory",
  "options.cron.form.workdir.placeholder": "Defaults to $HOME",
  "options.cron.form.workdir.choose": "Choose working directory",
  "options.cron.form.delivery": "Delivery",
  "options.cron.form.delivery.hint":
    "local keeps the result in Amiba; all or a platform target also sends it out.",
  "options.cron.form.advanced.show": "Advanced",
  "options.cron.form.advanced.hide": "Hide advanced",
  "options.cron.form.directScript": "Run script directly",
  "options.cron.form.directScript.hint":
    "Skip the model and run the script as the automation.",
  "options.cron.form.script": "Script",
  "options.cron.form.script.placeholder":
    "A script under ~/.hermes/scripts or an absolute path",
  "options.cron.form.repeat": "Run limit",
  "options.cron.form.repeat.placeholder": "Blank means unlimited",
  "options.cron.state.scheduled": "Enabled",
  "options.cron.state.running": "Running",
  "options.cron.state.paused": "Paused",
  "options.cron.state.completed": "Completed",
  "options.cron.state.error": "Needs attention",
  "options.cron.state.unknown": "Unknown",
  "options.cron.mode.directScript": "Direct script",
  "options.cron.meta.nextRun": "Next {time}",
  "options.cron.meta.noNextRun": "No next run",
  "options.cron.meta.neverRun": "Never run",
  "options.cron.meta.lastSucceeded": "Last succeeded {time}",
  "options.cron.meta.lastFailed": "Last failed {time}",
  "options.cron.meta.lastRun": "Last run {time}",
  "options.cron.action.runNow": "Run now",
  "options.cron.action.pause": "Pause",
  "options.cron.action.resume": "Resume",
  "options.cron.action.edit": "Edit task",
  "options.cron.action.copyId": "Copy task ID",
  "options.cron.action.delete": "Delete task",
  "options.cron.action.menu": "Task actions",
  "options.cron.action.moreNamed": "More actions for {name}",
  "options.cron.action.pauseNamed": "Pause {name}",
  "options.cron.action.resumeNamed": "Resume {name}",
  "options.cron.action.copied": "Task ID copied",
  "options.cron.action.copyFailed": "Couldn't copy the task ID",
  "options.cron.action.deleteConfirm":
    "Delete “{name}”? Its saved outputs will also be removed.",

  // Status + logs
  "options.status.title": "Status",
  "options.status.subtitle": "Health, versions, paths, and maintenance actions",
  "options.status.refresh": "Refresh",
  "options.status.lastChecked": "Checked {time}",
  "options.status.health.healthy.title": "All systems operational",
  "options.status.health.healthy.subtitle":
    "Hermes and the local gateway are responding normally.",
  "options.status.health.offline.title": "Gateway is offline",
  "options.status.health.offline.subtitle":
    "Hermes was detected, but its local gateway is not currently running.",
  "options.status.health.mismatch.title": "Components need attention",
  "options.status.health.mismatch.subtitle":
    "The desktop app and backplane protocol versions do not match.",
  "options.status.health.mismatch.hermesVersion":
    "The installed Hermes version is below Amiba's supported minimum.",
  "options.status.metric.gateway": "Gateway",
  "options.status.metric.online": "Online",
  "options.status.metric.offline": "Offline",
  "options.status.metric.sessions": "Active sessions",
  "options.status.metric.update": "Hermes update",
  "options.status.metric.updateAvailable": "Update available",
  "options.status.runtime.title": "Hermes runtime",
  "options.status.runtime.subtitle":
    "Installed version and local configuration",
  "options.status.runtime.release": "Release",
  "options.status.runtime.configVersion": "Config version",
  "options.status.runtime.latest": "latest {version}",
  "options.status.runtime.activeSessions": "Active sessions",
  "options.status.runtime.paths": "Paths and configuration",
  "options.status.runtime.hermesHome": "Hermes home",
  "options.status.runtime.configPath": "Config path",
  "options.status.runtime.envPath": "Environment path",
  "options.status.gateway.title": "Local gateway",
  "options.status.gateway.subtitle": "Process and connected platform state",
  "options.status.gateway.state": "State",
  "options.status.gateway.pid": "Process ID",
  "options.status.gateway.updatedAt": "Last state change",
  "options.status.gateway.platforms": "Platforms",
  "options.status.gateway.noPlatforms": "None connected",
  "options.status.gateway.lastExit": "Last exit",
  "options.status.actions.title": "Maintenance",
  "options.status.actions.subtitle":
    "Restart local services or update Hermes without leaving the app.",
  "options.status.actions.restart.title": "Restart gateway",
  "options.status.actions.restart.description":
    "Restart the local gateway process. Active conversations remain saved.",
  "options.status.actions.restart.button": "Restart gateway",
  "options.status.actions.update.title": "Update Hermes",
  "options.status.actions.update.description":
    "Install the latest Hermes release and refresh its runtime files.",
  "options.status.actions.update.button": "Update Hermes",
  "options.status.actions.update.latest": "Already on the latest version",
  "options.status.actions.update.available": "A newer version is available",
  "options.status.actions.update.behind": "{count} commits behind upstream",
  "options.status.actions.update.unknown": "Update status unavailable",
  "options.status.actions.running": "Running",
  "options.status.actions.success": "Completed",
  "options.status.actions.failed": "Failed",
  "options.status.actions.restartOutput": "Gateway restart output",
  "options.status.protocol.title": "Protocol version mismatch",
  "options.status.protocol.backplane":
    "Backplane protocol v{current} is older than the required v{expected}. Update the backplane plugin.",
  "options.status.protocol.client":
    "Backplane protocol v{current} is newer than the supported v{expected}. Update the desktop app.",
  "options.status.hermesVersion.title": "Hermes update required",
  "options.status.hermesVersion.unsupported":
    "Hermes {current} is installed. This version of Amiba requires Hermes {required} or newer; other Hermes operations are disabled until you update.",
  "options.status.hermesVersion.unverifiable":
    "Amiba could not verify the installed Hermes version. Install Hermes {required} or newer before continuing.",
  "options.status.onboarding.title": "Local service is unavailable",
  "options.status.onboarding.description":
    "Amiba cannot reach the local backplane. The desktop app normally starts it automatically; use the checks below if it stays offline.",
  "options.status.onboarding.retry": "Check again",
  "options.status.onboarding.step.install":
    "Confirm Hermes Agent is installed.",
  "options.status.onboarding.step.plugin":
    "Install the Amiba browser-tools plugin.",
  "options.status.onboarding.step.run":
    "Start the gateway and local backplane services.",
  "options.status.onboarding.manual": "Manual startup commands",
  "options.status.onboarding.copy": "Copy",
  "options.status.onboarding.copied": "Copied",
  "options.status.onboarding.error": "Technical details",
  "options.status.viewUpdateLogs": "View update logs",
  "options.logs.title": "Logs",
  "options.logs.subtitle": "Tail Hermes Agent and Hermes update logs",
  "options.logs.refresh": "Refresh",
  "options.logs.autoRefresh": "Auto",
  "options.logs.live": "live",
  "options.logs.empty": "No matching log lines.",
  "options.logs.failedToLoad": "Failed to load logs",
  "options.logs.lineCount": "{count} lines",
  "options.logs.file.label": "Source",
  "options.logs.file.agent": "agent",
  "options.logs.file.errors": "errors",
  "options.logs.file.gateway": "gateway",
  "options.logs.file.hermesUpdate": "Hermes update",
  "options.logs.action.running": "updating",
  "options.logs.action.empty": "No Hermes update output yet.",
  "options.logs.level.label": "Level",
  "options.logs.component.label": "Component",
  "options.logs.component.all": "all",
  "options.logs.component.gateway": "gateway",
  "options.logs.component.agent": "agent",
  "options.logs.component.tools": "tools",
  "options.logs.component.cli": "cli",
  "options.logs.component.cron": "cron",
  "options.logs.lines.label": "Lines",
  "options.logs.search.label": "Search",
  "options.logs.search.placeholder": "Substring filter (case-insensitive)",

  // Sidepanel
  "sidepanel.newChat": "Start a new task",
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
  "sidepanel.placeholder.withPinned": "Ask about the attached page(s)…",
  "sidepanel.send": "Send",
  "sidepanel.send.tooltip": "Send (⌘/Ctrl+Enter)",
  "sidepanel.modelPicker.label": "Choose model",
  "sidepanel.modelPicker.description":
    "Search and choose the model used for new task runs.",
  "sidepanel.modelPicker.search": "Search models or providers…",
  "sidepanel.modelPicker.noMatches": "No matching models.",
  "sidepanel.modelPicker.loading": "Loading available models…",
  "sidepanel.modelPicker.loadFailed": "Couldn’t load models. Reopen to retry.",
  "sidepanel.modelPicker.switchFailed": "Couldn’t switch models. Try again.",
  "sidepanel.modelPicker.virtualCapabilities": "Multi-model collaboration",
  "sidepanel.queue.tooltip": "Queue: send after the current turn finishes",
  "sidepanel.stop": "Stop generation",
  "sidepanel.regenerate": "Regenerate",
  "sidepanel.sessions": "Sessions",
  "sidepanel.tabs": "Tabs",
  "sidepanel.trace.thoughtProcess": "Thought process",
  "sidepanel.trace.thinking": "Thinking…",
  "sidepanel.trace.toolDetails": "Tool-call details",
  "sidepanel.trace.executionDetails": "Execution details",
  "sidepanel.trace.executionComplete": "Completed",
  "sidepanel.trace.executionRunning": "Running",
  "sidepanel.trace.toolCount": "{count} tool calls",
  "sidepanel.trace.runningTool": "Running",
  "sidepanel.trace.usedTool": "Used",
  "sidepanel.trace.generating": "Generating answer…",
  "sidepanel.trace.expandDetails": "Show details",
  "sidepanel.trace.collapseDetails": "Hide details",
  "sidepanel.trace.progressNote": "Progress note",
  "sidepanel.trace.actions.searchWeb": "Search the web",
  "sidepanel.trace.actions.readWeb": "Read webpage",
  "sidepanel.trace.actions.browse": "Browse",
  "sidepanel.trace.actions.inspectPage": "Inspect page",
  "sidepanel.trace.actions.click": "Click",
  "sidepanel.trace.actions.type": "Type",
  "sidepanel.trace.actions.readFile": "Read file",
  "sidepanel.trace.actions.writeFile": "Write file",
  "sidepanel.trace.actions.editFile": "Edit file",
  "sidepanel.trace.actions.searchFiles": "Search files",
  "sidepanel.trace.actions.runCommand": "Run command",
  "sidepanel.trace.actions.runCode": "Run code",
  "sidepanel.trace.actions.delegate": "Delegate task",
  "sidepanel.trace.actions.updateTasks": "Update tasks",
  "sidepanel.trace.actions.useSkill": "Use skill",
  "sidepanel.trace.actions.updateMemory": "Update memory",
  "sidepanel.trace.actions.generateMedia": "Generate media",
  "sidepanel.trace.actions.inspectMedia": "Inspect media",
  "sidepanel.trace.actions.askUser": "Ask user",
  "sidepanel.trace.actions.schedule": "Manage schedule",
  "sidepanel.trace.actions.searchSessions": "Search past sessions",
  "sidepanel.trace.actions.manageProject": "Manage project",
  "sidepanel.trace.actions.manageBoard": "Manage task board",
  "sidepanel.trace.actions.sendMessage": "Send message",
  "sidepanel.trace.actions.controlDevice": "Control device",
  "sidepanel.trace.actions.controlMedia": "Control media",
  "sidepanel.trace.actions.useTool": "Use tool",
  "sidepanel.trace.fields.path": "Path",
  "sidepanel.trace.fields.lines": "Lines",
  "sidepanel.trace.fields.workdir": "Working directory",
  "sidepanel.trace.fields.command": "Command",
  "sidepanel.trace.fields.language": "Language",
  "sidepanel.trace.fields.code": "Code",
  "sidepanel.trace.fields.output": "Output",
  "sidepanel.trace.fields.result": "Result",
  "sidepanel.trace.fields.arguments": "Arguments",
  "sidepanel.trace.fields.query": "Query",
  "sidepanel.trace.fields.url": "URL",
  "sidepanel.trace.fields.exitCode": "Exit code",
  "sidepanel.trace.fields.diff": "Changes",
  "sidepanel.trace.fields.matches": "Matches",
  "sidepanel.trace.searchResults.count": "{count} results",
  "sidepanel.trace.searchResults.matches": "{count} matches",
  "sidepanel.trace.searchResults.truncated": "Results truncated",
  "sidepanel.trace.searchResults.empty": "No matching files",
  "sidepanel.trace.searchResults.openFile": "Open file in workbench",
  "sidepanel.trace.fields.goal": "Goal",
  "sidepanel.trace.fields.role": "Role",
  "sidepanel.trace.fields.action": "Action",
  "sidepanel.trace.fields.target": "Target",
  "sidepanel.trace.fields.name": "Name",
  "sidepanel.trace.fields.prompt": "Prompt",
  "sidepanel.trace.emptyResult": "No inspectable result",
  "sidepanel.attach": "Attach files",
  "sidepanel.attach.tooltip": "Attach files (multi-select supported)",
  "sidepanel.openOptions": "Open options",
  "sidepanel.pin": "Pin",
  "sidepanel.pin.pinAria": "Attach current page to next message",
  "sidepanel.pin.unpinAria": "Unpin current page",
  "sidepanel.pin.pinTooltip":
    "Attach the current page to the next message (one-shot snapshot)",
  "sidepanel.pin.unpinTooltip": "Detach this page from the next message",
  "sidepanel.learn.record": "Record actions",
  "sidepanel.learn.recording": "Recording · {count} steps",
  "sidepanel.learn.stop": "Stop and attach",
  "sidepanel.learn.processing": "Processing…",
  "sidepanel.learn.tooltip":
    "Record clicks and input on the active tab; the trace JSON will be attached to the conversation when you stop. Write your prompt yourself.",
  "sidepanel.queue.sendNow":
    "Send now: jump this message to the front of the queue",
  "sidepanel.queue.sendNow.aria": "Send now",
  "sidepanel.queue.edit":
    "Edit: load this message into the composer (keeps queue position, pauses the queue)",
  "sidepanel.queue.edit.aria": "Edit",
  "sidepanel.queue.delete": "Delete",
  "sidepanel.queue.editing": "This message is being edited in the composer",
  "sidepanel.composer.cancelEdit":
    "Cancel edit (discards composer changes; the queued item is unchanged)",
  "sidepanel.composer.cancelEdit.aria": "Cancel edit",
  "sidepanel.composer.kbd.send": "send",
  "sidepanel.composer.kbd.newline": "newline",
  "quickAsk.selectionFrom": "Selection from",
  "quickAsk.kbd.ask": "ask",
  "quickAsk.kbd.newline": "newline",
  "quickAsk.kbd.new": "new",
  "quickAsk.kbd.dismiss": "dismiss",
  "quickAsk.continuation.label": "Continuing chat from {time}",
  "quickAsk.continuation.new": "⌘K new",
  "quickAsk.continuation.dismiss": "Dismiss",
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
    "This command contains an embedded script that Hermes could not fully verify. Confirm before running it.",
  "sidepanel.permission.reason.parserLimit":
    "This command is too complex for Hermes to fully verify. Confirm before running it.",
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
    "No response before gateway_timeout; the server auto-denied and unblocked",
  "sidepanel.permission.submitFailed": "Submit failed",
  "sidepanel.permission.submitFailed.tooltip":
    "POST /v1/runs/{runId}/approval request failed",
  "sidepanel.permission.waiting": "Waiting",
  "sidepanel.permission.chip.tool": "Tool: {tool}",
  "sidepanel.permission.chip.command": "Command: {command}",
  "sidepanel.permission.chip.reason": "Reason: {reason}",
  "sidepanel.permission.chip.requested": "Requested: {time}",
  "sidepanel.permission.chip.decided": "Decided: {time}",
  "sidepanel.permission.failedRecordStart": "Failed to start recording",
  "sidepanel.permission.failedRecordStop": "Failed to stop recording",
  "sidepanel.permission.dismissError": "Dismiss error",
  "sidepanel.attachment.uploading": "Uploading",
  "sidepanel.attachment.removeAria": "Remove {name}",
  "sidepanel.attachment.removePage": "Remove attached page",
  "sidepanel.attachment.autoFrom": "Auto-attached from {source}",
  "sidepanel.attachment.autoFrom.fallback": "current tab",
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
  "sidepanel.empty.settings": "Settings",
  // Empty-state connect prompt — shown in place of the composer when
  // the bridge isn't reachable. Submitting a prompt would just error.
  "sidepanel.empty.notConnected.title": "Not connected to Amiba",
  "sidepanel.empty.notConnected.description":
    "Connect to the Hermes bridge first to start chatting.",
  "sidepanel.empty.notConnected.button": "Connect",
  "sidepanel.empty.notConnected.connecting": "Connecting…",

  // Bridge status bar
  "sidepanel.status.connecting": "Connecting…",
  "sidepanel.status.online": "Online",
  "sidepanel.status.offline": "Offline",
  "sidepanel.status.bridgeUrl": "Bridge: {url}",
  "sidepanel.status.tooltip.online":
    "Hermes bridge is reachable. Click to open Gateway settings.",
  "sidepanel.status.tooltip.offline":
    "Hermes gateway is not reachable. Start `hermes chat` and check the Gateway URL.",
  "sidepanel.status.tooltip.connecting": "Connecting to the Hermes bridge…",
  "sidepanel.status.tooltipBase": "Amiba Browser Extension · {state}",
  "sidepanel.status.tooltip.agentRunning":
    "Agent window: #{windowId} · tab {tabId}",
  "sidepanel.status.tooltip.agentDown": "Agent window: not running",
  "sidepanel.status.tooltip.clickConnect": "Click to connect",
  "sidepanel.status.tooltip.clickDisconnect": "Click to disconnect",
  "sidepanel.status.aria.bar": "Amiba Browser Extension {label}. {action}.",
  "sidepanel.status.showAgentWindow": "Show agent window",
  "sidepanel.status.showAgentWindow.disabled":
    "Agent window not running — connect first",
  "sidepanel.status.dismiss": "Dismiss",

  // Navigate open policy toggle
  "sidepanel.navPolicy.label": "Open links",
  "sidepanel.navPolicy.background": "In background tab",
  "sidepanel.navPolicy.foreground": "In foreground tab",
  "sidepanel.navPolicy.sameTab": "Replace current tab",
  "sidepanel.navPolicy.tooltip": "Where to open links the agent navigates to.",
  "sidepanel.navPolicy.listAria": "Navigate opens",
  "sidepanel.navPolicy.auto.label": "Auto",
  "sidepanel.navPolicy.auto.desc":
    "Model picks via open_in on each navigate; other tools follow the active run surface (updated by navigate + this menu when not Auto).",
  "sidepanel.navPolicy.agent.label": "Agent",
  "sidepanel.navPolicy.agent.desc":
    "Dedicated agent window — all browser tools and in-place navigations.",
  "sidepanel.navPolicy.userNewTab.label": "New tab",
  "sidepanel.navPolicy.userNewTab.desc":
    "Your Chrome window — each navigate opens a new tab; other tools follow that tab.",
  "sidepanel.navPolicy.userSameTab.label": "Same tab",
  "sidepanel.navPolicy.userSameTab.desc":
    "Your Chrome window — navigations and tools use the current tab.",

  // Session drawer
  "sidepanel.sessions.title": "Recent tasks",
  "sidepanel.sessions.viewAll": "View all tasks",
  "sidepanel.sessions.empty": "No sessions yet. Send a message to start one.",
  "sidepanel.sessions.dialogAria": "Session history",
  "sidepanel.sessions.close": "Close",
  "sidepanel.sessions.openAsTab": "Open as tab",
  "sidepanel.sessions.rename": "Rename",
  "sidepanel.sessions.deletePermanently": "Delete permanently",
  "sidepanel.sessions.save": "Save",
  "sidepanel.sessions.cancel": "Cancel",
  "sidepanel.sessions.newChatTitle": "New task",
  "sidepanel.sessions.deleteConfirm":
    'Permanently delete "{title}"? This drops the session and its messages from History — closing the tab from the top bar would have just hidden it.',
  "sidepanel.sessions.group.pinned": "Pinned",
  "sidepanel.sessions.group.today": "Today",
  "sidepanel.sessions.group.yesterday": "Yesterday",
  "sidepanel.sessions.group.earlierWeek": "Earlier this week",
  "sidepanel.sessions.group.thisMonth": "This month",
  "sidepanel.sessions.group.older": "Older",
  "sidepanel.sessions.group.chats": "Chats",
  "sidepanel.sessions.group.unbound": "Independent tasks",
  // Channel-scoped section label: ``{name} chats`` — used for both the
  // local "Local chats" section and remote channel sections ("Feishu
  // chats", "Telegram chats", …). Single template keeps section
  // labels uniform across origins.
  "sidepanel.sessions.group.channelChats": "{name} chats",
  "sidepanel.sessions.group.scheduled": "Automation runs",

  // Task center / Kanban
  "tasks.title": "Tasks",
  "tasks.search": "Search tasks…",
  "tasks.create": "New task",
  "tasks.loadFailed": "Couldn't load tasks",
  "tasks.createFailed": "Couldn't create the task",
  "tasks.column.planning": "Planned",
  "tasks.column.ready": "Ready",
  "tasks.column.running": "In progress",
  "tasks.column.attention": "Needs attention",
  "tasks.column.done": "Done",
  "tasks.column.empty": "No tasks",
  "tasks.status.triage": "Triage",
  "tasks.status.todo": "To do",
  "tasks.status.scheduled": "Scheduled",
  "tasks.status.ready": "Ready",
  "tasks.status.running": "Running",
  "tasks.status.blocked": "Blocked",
  "tasks.status.review": "Review",
  "tasks.status.done": "Done",
  "tasks.status.archived": "Archived",
  "tasks.field.title": "Title",
  "tasks.field.body": "Instructions",
  "tasks.field.assignee": "Agent",
  "tasks.field.workdir": "Working directory",
  "tasks.field.chooseWorkdir": "Choose working directory",
  "tasks.assignee.unassigned": "Unassigned — won't run automatically",
  "tasks.latestSummary": "Latest handoff",
  "modelSelection.inherit": "Use the default model",
  "modelSelection.inherit.description":
    "Follow the active agent profile's default model.",
  "sidepanel.sessions.history.empty": "No chats or scheduled runs yet.",
  "sidepanel.sessions.layout.aria": "History layout",
  "sidepanel.sessions.layout.timeline": "All by time",
  "sidepanel.sessions.layout.grouped": "Group chats by workspace",
  "sidepanel.nav.section.workspace": "Workspace",
  "sidepanel.sessions.showMore": "Show more",
  "sidepanel.sessions.unread": "Unread update",
  "sidepanel.sessions.running": "Running",
  "sidepanel.sessions.activityBar.aria": "Sidebar views",
  "sidepanel.sessions.scheduled.loading": "Loading…",
  "sidepanel.sessions.scheduled.empty":
    "No scheduled tasks yet. Create one from a chat to get started.",
  "sidepanel.sessions.scheduled.error":
    "Couldn't load scheduled tasks. Check that the backplane is running.",
  "sidepanel.sessions.scheduled.noRuns": "No runs yet.",
  "sidepanel.sessions.scheduled.selectRun": "Select a run to view its output.",
  "sidepanel.sessions.scheduled.trigger": "Trigger now",
  "sidepanel.sessions.scheduled.triggerConfirm":
    'Run "{name}" now? It will fire on the next scheduler tick.',
  "sidepanel.sessions.scheduled.triggerFailed": "Trigger failed: {error}",

  // New tab
  "newtab.greeting": "What can I help with?",
  "newtab.subtitle":
    "Look something up, read a page, handle Feishu, run a script — just tell me what you need.",
  // Typewriter cycle in the new-tab composer — keep each line short
  // enough to fit on one line at the default composer width (~640px)
  // and concrete enough to suggest a real capability rather than just
  // "ask me anything".
  "newtab.placeholder.example.1": "What's on my calendar today?",
  "newtab.placeholder.example.2": "Translate this paragraph to Chinese…",
  "newtab.placeholder.example.3": "Summarise this web page",
  "newtab.placeholder.example.4": "Latest AI news from the Valley",
  "newtab.placeholder.example.5": "Implement quicksort in Python",
  "newtab.send": "Send",
  "newtab.send.tooltip": "Send (Enter)",
  "workspace.openFolder": "Open folder",
  "workspace.context": "Execution context",
  "workspace.changeFolder": "Change workspace folder",
  "workspace.clearFolder": "Clear workspace folder",
  "workspace.pickerFailed": "Couldn't open that folder: {error}",
  "sidepanel.context.from": "From",
  "sidepanel.context.dismissSource": "Dismiss source context",
  "newtab.openOptions": "Open Amiba options",
  "newtab.history": "History",
  "newtab.latest": "Latest",
  "newtab.recentChats": "Recent chats",
  "newtab.clickToResume": "Click to resume",
  "newtab.row.failed": "— failed",
  "newtab.row.silent": "— nothing new",
  "newtab.row.msgs": "{count} msgs",
  "newtab.content.empty": "No cron run output yet.",
  "newtab.content.empty.row": "No output recorded for this run.",
  "newtab.content.truncated":
    "Output file exceeded the bridge's in-memory cap — only the head of the run is shown above.",
  "newtab.continueInChat": "Continue in chat",
  "newtab.continueInChat.prompt":
    'Below is the output from cron job "{name}" at {time}. Help me read it: what\'s worth handling right away, what can wait, and is there anything I need to follow up on?\n\n---\n\n{content}',
  "newtab.empty.installed": "Routine enabled",
  "newtab.empty.headline": "Get Amiba working for you",
  "newtab.empty.installedDesc":
    "It'll show up here after its next run. Add more, or wait for the first output.",
  "newtab.empty.headlineDesc":
    "Pick a routine — Amiba runs it on a schedule and the output lands here.",
  "newtab.empty.customCron": "Set up a custom cron job →",
  "newtab.install.failed": "Failed to install",
  "newtab.relative.justNow": "just now",
  "newtab.relative.mAgo": "{n}m ago",
  "newtab.relative.hAgo": "{n}h ago",
  "newtab.relative.dAgo": "{n}d ago",

  // Home shortcuts strip
  "newtab.shortcuts.title": "Shortcuts",
  "newtab.shortcuts.add": "Add",
  "newtab.shortcuts.add.tooltip": "Add a shortcut",
  "newtab.shortcuts.remove": "Remove",
  "newtab.shortcuts.rename": "Rename",
  "newtab.shortcuts.manage": "Manage",
  "newtab.shortcuts.manage.tooltip": "Manage shortcuts",
  "newtab.shortcuts.manage.title": "Manage shortcuts",
  "newtab.shortcuts.manage.close": "Close",
  "newtab.shortcuts.manage.moveUp": "Move up",
  "newtab.shortcuts.manage.moveDown": "Move down",
  "newtab.shortcuts.manage.listEmpty":
    "No shortcuts yet. Add your first one above.",
  "newtab.shortcuts.add.dialog.title": "Add a shortcut",
  "newtab.shortcuts.add.dialog.urlLabel": "URL",
  "newtab.shortcuts.add.dialog.urlPlaceholder": "https://example.com",
  "newtab.shortcuts.add.dialog.titleLabel": "Name",
  "newtab.shortcuts.add.dialog.titlePlaceholder":
    "Leave empty to use the page title",
  "newtab.shortcuts.add.dialog.useCurrentTab": "Use current active tab",
  "newtab.shortcuts.add.dialog.confirm": "Add",
  "newtab.shortcuts.add.dialog.cancel": "Cancel",
  "newtab.shortcuts.add.invalidUrl":
    "Enter a valid URL including http:// or https://.",
  "newtab.shortcuts.empty":
    "No shortcuts yet — click ⚙ Manage on the right to add your first one.",

  // Wallpaper
  "newtab.wallpaper.cycle": "Next wallpaper",

  // Chat tab
  "chat.title": "Amiba chat",
  "chat.goHome": "Back to home",
  "chat.newChat": "New task",
  "chat.placeholder": "Send a message…",
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
  "chat.delete": "Delete",
  "chat.width.label": "Message column width",
  "chat.width.narrow": "Narrow",
  "chat.width.narrow.tooltip": "Narrow message column (same as input)",
  "chat.width.medium": "Medium",
  "chat.width.medium.tooltip": "Medium message column",
  "chat.width.full": "Full",
  "chat.width.full.tooltip": "Full-width messages",
  "chat.group.today": "Today",
  "chat.group.yesterday": "Yesterday",
  "chat.group.older": "Older",
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
  // — extension, desktop main window, Quick-Ask. The backplane
  // migrates legacy ``source="browser-extension"`` / ``"desktop"``
  // rows to the unified ``"local"`` value on boot, so the renderer
  // only ever sees one local source.
  "channels.cli": "CLI",
  "channels.tui": "TUI",
  "channels.cron": "Scheduled",
  "channels.feishu": "Feishu",
  "channels.telegram": "Telegram",
  "channels.slack": "Slack",
  "channels.discord": "Discord",
  "channels.wecom": "WeCom",
  "channels.weixin": "WeChat",
  "channels.dingtalk": "DingTalk",
  "channels.whatsapp": "WhatsApp",
  "channels.signal": "Signal",
  "channels.matrix": "Matrix",
  "channels.email": "Email",
  "channels.sms": "SMS",
  "channels.webhook": "Webhook",
  "channels.homeassistant": "Home Assistant",
  "channels.bluebubbles": "iMessage",
  "channels.qqbot": "QQ",
  "channels.yuanbao": "Yuanbao",
  "channels.gateway": "Gateway",
  "channels.api": "API",
  "channels.local": "Local",
  "channels.unknown": "Other",
  "channels.remoteTitle": "From {name}",
  "sidepanel.sessions.readOnlyBadge": "Read-only",
  "sidepanel.sessions.readOnlyNotice":
    "This conversation lives on {name}. Continue there to send a new message.",

  // Tokens + Tools pages
  "options.nav.tokens": "Tokens",
  "options.nav.tools": "Tools",
  "usage.range.today": "Today",
  "usage.range.lastN": "{n}d",
  "usage.heatmap.dow.mon": "M",
  "usage.heatmap.dow.wed": "W",
  "usage.heatmap.dow.fri": "F",
  "usage.heatmap.legend.less": "Less",
  "usage.heatmap.legend.more": "More",
  "usage.heatmap.range": "{weeks}w",
  "usage.heatmap.tooltip.none": "no activity",
  "usage.label.noData": "No data yet.",
  "usage.label.percentage": "{pct}%",
  "usage.tokens.hero.tokens": "Tokens",
  "usage.tokens.hero.turns": "Turns",
  "usage.tokens.hero.sessions": "Sessions",
  "usage.tokens.section.activity": "Activity",
  "usage.tokens.section.trend": "Activity trend",
  "usage.tokens.section.byModel": "By model",
  "usage.tokens.section.recent": "Recent sessions",
  "usage.tokens.heatmap.tooltip.tokens": "tokens",
  "usage.tokens.label.turns": "{count} turns",
  "usage.tokens.label.tokens": "{in} in / {out} out",
  "usage.tokens.label.placeholder": "Unknown",
  "usage.tokens.label.placeholderHint":
    "No specific model was recorded for this session. The gateway used its default routing — the real model that ran isn't stored per-session.",
  "usage.tokens.footer.source":
    "Data from hermes-agent · auto-refreshes every 30 s",
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

  // Profile-scoped tools, with internal implementation details curated away.
  "agentCapabilities.title": "Tools",
  "agentCapabilities.subtitle":
    "Manage the built-in and external tools available to this assistant.",
  "agentCapabilities.loadFailed": "Could not load built-in tools.",
  "agentCapabilities.empty": "No configurable built-in tools are available.",
  "agentCapabilities.back": "Back to tools",
  "agentCapabilities.builtin.title": "Built-in tools",
  "agentCapabilities.builtin.description":
    "Provided by Hermes and organized by purpose for easier setup.",
  "agentCapabilities.enabledForAssistant":
    "Allow this assistant to use this tool",
  "agentCapabilities.activity.title": "Tool usage",
  "agentCapabilities.activity.description":
    "A diagnostic record of recent tool calls.",
  "agentCapabilities.activity.action": "Usage",
  "agentCapabilities.scope.device": "Shared on this device",
  "agentCapabilities.status.ready": "Ready",
  "agentCapabilities.status.attention": "Needs setup",
  "agentCapabilities.status.off": "Off",
  "agentCapabilities.group.understand.title": "Understand content",
  "agentCapabilities.group.understand.description":
    "Help Amiba interpret visual information you share.",
  "agentCapabilities.group.web.title": "Find and use information",
  "agentCapabilities.group.web.description":
    "Search, read and interact with information on the web.",
  "agentCapabilities.group.create.title": "Create content",
  "agentCapabilities.group.create.description":
    "Turn instructions into images, video and spoken audio.",
  "agentCapabilities.group.device.title": "Work on this device",
  "agentCapabilities.group.device.description":
    "Control how Amiba works with files, code and desktop applications.",
  "agentCapabilities.group.connect.title": "Connected services",
  "agentCapabilities.group.connect.description":
    "Let Amiba act in services and devices you already use.",
  "agentCapabilities.item.vision.title": "Understand images",
  "agentCapabilities.item.vision.description":
    "Read screenshots, photos, diagrams and other visual material.",
  "agentCapabilities.item.video.title": "Understand video",
  "agentCapabilities.item.video.description":
    "Review video content with a video-capable model.",
  "agentCapabilities.item.web.title": "Search and read the web",
  "agentCapabilities.item.web.description":
    "Choose services for search results and page extraction.",
  "agentCapabilities.item.browser.title": "Operate web pages",
  "agentCapabilities.item.browser.description":
    "Choose how Amiba navigates, clicks and types in a browser.",
  "agentCapabilities.item.xSearch.title": "Search X",
  "agentCapabilities.item.xSearch.description":
    "Find public posts and conversations on X.",
  "agentCapabilities.item.imageGen.title": "Generate images",
  "agentCapabilities.item.imageGen.description":
    "Choose an image service and its default model.",
  "agentCapabilities.item.videoGen.title": "Generate video",
  "agentCapabilities.item.videoGen.description":
    "Create or edit video from text and reference material.",
  "agentCapabilities.item.tts.title": "Read text aloud",
  "agentCapabilities.item.tts.description":
    "Choose the voice service used to create spoken audio.",
  "agentCapabilities.item.terminal.title": "Run code and commands",
  "agentCapabilities.item.terminal.description":
    "Choose one environment for both code and command execution.",
  "agentCapabilities.item.codeExecution.title": "Execute code",
  "agentCapabilities.item.codeExecution.description":
    "Allow Amiba to run code needed to complete a task.",
  "agentCapabilities.item.file.title": "Work with files",
  "agentCapabilities.item.file.description":
    "Read, create and update files you place in scope.",
  "agentCapabilities.item.computerUse.title": "Control desktop apps",
  "agentCapabilities.item.computerUse.description":
    "Set up the driver and operating-system permissions for desktop control.",
  "agentCapabilities.item.homeAssistant.title": "Control your smart home",
  "agentCapabilities.item.homeAssistant.description":
    "Connect Home Assistant devices and services.",
  "agentCapabilities.item.spotify.title": "Use Spotify",
  "agentCapabilities.item.spotify.description":
    "Search music and control playback, playlists and your library.",
  "agentCapabilities.item.discord.title": "Participate in Discord",
  "agentCapabilities.item.discord.description":
    "Read messages, find members and take part in conversations.",
  "agentCapabilities.item.discordAdmin.title": "Manage a Discord server",
  "agentCapabilities.item.discordAdmin.description":
    "Work with channels, roles, pins and server administration.",
  "agentCapabilities.item.yuanbao.title": "Use Yuanbao groups",
  "agentCapabilities.item.yuanbao.description":
    "Query groups and members, send messages and use stickers.",

  // User-added extensions and tools.
  "externalTools.tab.extensions": "App extensions",
  "externalTools.tab.plugins": "Agent plugins",
  "externalTools.tab.mcp": "MCP",
  "externalTools.tab.cli": "CLI tools",
  "externalTools.status.enabled": "Enabled",
  "externalTools.status.disabled": "Disabled",
  "externalTools.configure": "Configure",
  "externalTools.plugin.add": "Add plugin",
  "externalTools.plugin.addPrompt":
    "Help me find and add an Agent plugin. Ask what I need it for, explain the source and permissions, and ask for confirmation before installing anything.",
  "externalTools.mcp.title": "External tools",
  "externalTools.mcp.subtitle":
    "Connect tools provided by external services through MCP.",
  "externalTools.mcp.loadFailed": "Could not load MCP services.",
  "externalTools.mcp.add": "Add MCP",
  "externalTools.mcp.source": "MCP",
  "externalTools.mcp.addPrompt":
    "Help me find and add an MCP service for Hermes assistant profile “{profile}”. First ask what I want Amiba to do, explain the options, and ask for confirmation before installing anything.",
  "externalTools.mcp.configurePrompt":
    "Help me inspect and configure MCP “{name}” (configuration name: {slug}) in Hermes assistant profile “{profile}”. Explain its current state first, and ask for confirmation before disabling, reconfiguring or removing it.",
  "externalTools.mcp.emptyTitle": "No MCP services added",
  "externalTools.mcp.emptyDescription":
    "Add one when you want Amiba to connect to an external tool or data source.",
  "externalTools.cli.subtitle":
    "Command-line programs you explicitly choose for Amiba to use.",
  "externalTools.cli.privacy":
    "Amiba does not scan every command installed on your computer.",
  "externalTools.cli.title": "Add a CLI tool through the Agent",
  "externalTools.cli.description":
    "Tell Amiba which command-line tool you need. It will inspect the environment, explain the installation or sign-in steps, and ask before making changes.",
  "externalTools.cli.add": "Add CLI tool",
  "externalTools.cli.addPrompt":
    "Help me add or configure a CLI tool for use in Amiba. Ask what I need it for, inspect whether it is already installed, explain the plan, and ask for confirmation before installing or changing anything.",

  // Agent capability configuration
  "tools.toggleFailed": "Toggle failed, please try again.",
  "tools.detail.loadFailed": "Failed to load detail.",
  "tools.detail.journey.done": "Done",
  "tools.detail.journey.todo": "Next",
  "tools.detail.noSetup.title": "No additional setup needed",
  "tools.detail.noSetup.description":
    "Enable this capability and Amiba can use it in a new conversation.",
  "tools.detail.noSetup.unavailableTitle": "This capability is not ready yet",
  "tools.detail.noSetup.unavailableDescription":
    "The current Hermes environment did not provide an actionable setup method. Update the runtime and check again.",
  "tools.detail.understanding.loadFailed": "Could not load available models.",
  "tools.detail.understanding.saveFailed":
    "Could not save the understanding model.",
  "tools.detail.understanding.routeTitle": "Current model source",
  "tools.detail.understanding.imageDescription":
    "Image understanding follows the main model by default. Choose a dedicated vision model when the main model cannot accept images.",
  "tools.detail.understanding.videoDescription":
    "Image and video understanding share one vision model. This is the model source both capabilities currently use.",
  "tools.detail.understanding.routeDedicated":
    "Using a dedicated understanding model",
  "tools.detail.understanding.routeVision":
    "Using the shared image-and-video model",
  "tools.detail.understanding.routeMain": "Following the main model",
  "tools.detail.understanding.noRoute": "No usable model selected",
  "tools.detail.understanding.mainSupportsImage":
    "The main model supports image input.",
  "tools.detail.understanding.mainLacksImage":
    "The main model does not support image input. Choose a dedicated model below.",
  "tools.detail.understanding.mainImageUnknown":
    "Amiba cannot confirm image support for the main model. You can select a known vision model below.",
  "tools.detail.understanding.chooseTitle": "Change the understanding model",
  "tools.detail.understanding.imageHint":
    "Only models available through Amiba model services are shown. Choose one that explicitly supports image input.",
  "tools.detail.understanding.videoHint":
    "Choose a model that explicitly supports video input. Image understanding will use the same model after you save.",
  "tools.detail.understanding.manageModels": "Manage model services",
  "tools.detail.understanding.noModels":
    "No models are available yet. Connect a model service from Models first.",
  "tools.detail.understanding.provider": "Model service",
  "tools.detail.understanding.model": "Model",
  "tools.detail.understanding.useDedicated": "Use dedicated model",
  "tools.detail.understanding.useShared": "Use for images and video",
  "tools.detail.understanding.followMain": "Follow main model",
  "tools.detail.understanding.saved": "Model source updated",
  "tools.detail.browser.backgroundTitle": "Background browser",
  "tools.detail.browser.backgroundDescription":
    "Opens pages and runs automation separately without taking over the tab you are using.",
  "tools.detail.browser.currentTabTitle": "Current browser tab",
  "tools.detail.browser.currentTabDescription":
    "Connect the Amiba browser extension to let the Agent work in a tab you already have open.",
  "tools.detail.provider.title": "Choose how it works",
  "tools.detail.provider.subtitle":
    "Pick the service that best matches your budget and privacy preference.",
  "tools.detail.provider.active": "In use",
  "tools.detail.provider.choose": "Choose",
  "tools.detail.provider.selecting": "Saving…",
  "tools.detail.provider.search": "Search provider",
  "tools.detail.provider.extract": "Page extraction provider",
  "tools.detail.provider.status.ready": "Ready",
  "tools.detail.provider.status.needsKey": "Key required",
  "tools.detail.provider.status.needsAuth": "Sign-in required",
  "tools.detail.provider.status.needsSetup": "Setup required",
  "tools.detail.provider.status.inactive": "Not selected",
  "tools.detail.provider.badge.recommended": "Recommended",
  "tools.detail.provider.badge.subscription": "Subscription",
  "tools.detail.credentials.title": "Connect your account",
  "tools.detail.credentials.description":
    "Secrets are stored securely on this device and are never shown again.",
  "tools.detail.credentials.savedPlaceholder":
    "Already saved — leave blank to keep it",
  "tools.detail.credentials.openProvider": "Get this value",
  "tools.detail.credentials.save": "Save connection",
  "tools.detail.credentials.saving": "Saving…",
  "tools.detail.credentials.saved": "Connection saved",
  "tools.detail.credentials.show": "Show entered value",
  "tools.detail.credentials.hide": "Hide entered value",
  "tools.detail.setup.title": "Install required component",
  "tools.detail.setup.description":
    "Amiba can automatically install and configure the components this service needs.",
  "tools.detail.setup.run": "Install and configure",
  "tools.detail.setup.running": "Installing…",
  "tools.detail.setup.connect": "Continue to connect",
  "tools.detail.setup.connecting": "Connecting…",
  "tools.detail.setup.configure": "Finish setup",
  "tools.detail.setup.configuring": "Configuring…",
  "tools.detail.setup.done": "Completed",
  "tools.detail.setup.info.open": "View setup details for {name}",
  "tools.detail.setup.info.changes": "What this will do",
  "tools.detail.setup.info.agentBrowser.title": "Local browser components",
  "tools.detail.setup.info.agentBrowser.description":
    "Prepares an isolated headless browser environment for Hermes on this device.",
  "tools.detail.setup.info.agentBrowser.detail.cli":
    "Installs the Node.js dependencies in the Hermes runtime, including the agent-browser controller.",
  "tools.detail.setup.info.agentBrowser.detail.chromium":
    "Downloads a matching Playwright Chromium/headless-shell build, usually about 170 MB; an existing compatible Chrome can be reused.",
  "tools.detail.setup.info.agentBrowser.detail.session":
    "Tasks run in isolated headless sessions and do not read your everyday Chrome accounts, cookies, or extensions by default.",
  "tools.detail.setup.info.agentBrowser.note":
    "Browser files normally live in Playwright's cache. Removing Hermes may not remove that cache automatically.",
  "tools.detail.setup.info.cloudBrowser.title": "Cloud browser controller",
  "tools.detail.setup.info.cloudBrowser.description":
    "The provider runs the browser in the cloud; Hermes installs a local controller to send it actions.",
  "tools.detail.setup.info.cloudBrowser.detail.cli":
    "Installs the agent-browser CLI and the Node.js dependencies required by the Hermes runtime.",
  "tools.detail.setup.info.cloudBrowser.detail.hosted":
    "Does not download local Chromium. Pages run in the cloud browser hosted by Browserbase, Browser Use, or Firecrawl.",
  "tools.detail.setup.info.camofox.title": "Camofox browser service",
  "tools.detail.setup.info.camofox.description":
    "Installs a local anti-detection Firefox/Camoufox browser service.",
  "tools.detail.setup.info.camofox.detail.package":
    "Installs the @askjo/camofox-browser Node.js package in the Hermes runtime.",
  "tools.detail.setup.info.camofox.detail.engine":
    "The first service start downloads the Camoufox browser engine, approximately 300 MB.",
  "tools.detail.setup.info.camofox.detail.service":
    "After installation, the local Camofox service still needs to be started, or you can use its Docker service.",
  "tools.detail.setup.info.cuaDriver.title": "Computer control driver",
  "tools.detail.setup.info.cuaDriver.description":
    "Installs cua-driver so Hermes can read the screen and perform mouse and keyboard actions in the background.",
  "tools.detail.setup.info.cuaDriver.detail.installer":
    "Downloads the official installer from the trycua/cua repository and installs the driver for this operating system.",
  "tools.detail.setup.info.cuaDriver.detail.process":
    "The driver runs as a local background process and does not use a Nous cloud computer.",
  "tools.detail.setup.info.cuaDriver.detail.permissions":
    "On macOS, Accessibility and Screen Recording permissions are still required after installation; the installer cannot grant them automatically.",
  "tools.detail.setup.info.fasterWhisper.title": "Local speech recognition",
  "tools.detail.setup.info.fasterWhisper.description":
    "Installs faster-whisper to transcribe speech on this device.",
  "tools.detail.setup.info.fasterWhisper.detail.package":
    "Installs the faster-whisper Python package into the environment used by Hermes.",
  "tools.detail.setup.info.fasterWhisper.detail.model":
    "The recognition model downloads on first use; the default is usually about 150 MB and other sizes are available.",
  "tools.detail.setup.info.fasterWhisper.detail.local":
    "Audio and transcription stay on this device and require no additional speech API key.",
  "tools.detail.setup.info.kittenTts.title": "KittenTTS local voice",
  "tools.detail.setup.info.kittenTts.description":
    "Installs a lightweight CPU-oriented local text-to-speech engine.",
  "tools.detail.setup.info.kittenTts.detail.package":
    "Installs KittenTTS and soundfile into the Hermes Python environment.",
  "tools.detail.setup.info.kittenTts.detail.model":
    "Downloads a voice model of approximately 25–80 MB, depending on the selected model.",
  "tools.detail.setup.info.kittenTts.detail.local":
    "Speech is generated locally and needs no account or remote API key.",
  "tools.detail.setup.info.piper.title": "Piper local voice",
  "tools.detail.setup.info.piper.description":
    "Installs Piper to generate speech locally on this device.",
  "tools.detail.setup.info.piper.detail.package":
    "Installs the roughly 14 MB piper-tts runtime into the Hermes Python environment.",
  "tools.detail.setup.info.piper.detail.voice":
    "The selected voice downloads separately on the first speech request.",
  "tools.detail.setup.info.piper.detail.local":
    "Speech is generated locally and needs no account or remote API key.",
  "tools.detail.setup.info.ddgs.title": "DuckDuckGo search component",
  "tools.detail.setup.info.ddgs.description":
    "Installs a DuckDuckGo search client that requires no API key.",
  "tools.detail.setup.info.ddgs.detail.package":
    "Installs the ddgs package into the Hermes Python environment.",
  "tools.detail.setup.info.ddgs.detail.scope":
    "It provides web search only, not page extraction; choose a separate extraction provider if you also need to read pages.",
  "tools.detail.setup.info.ddgs.detail.limits":
    "No account is required, but requests are still subject to DuckDuckGo's server-side rate limits.",
  "tools.detail.setup.info.spotify.title": "Connect Spotify",
  "tools.detail.setup.info.spotify.description":
    "Uses Spotify OAuth to let Hermes access playback and library features.",
  "tools.detail.setup.info.spotify.detail.browser":
    "Opens your system browser to complete Spotify sign-in and authorization.",
  "tools.detail.setup.info.spotify.detail.client":
    "If no Spotify app is configured yet, it first asks for a Client ID.",
  "tools.detail.setup.info.spotify.detail.storage":
    "Authorization data is stored in the local Hermes configuration; no extra browser or media player is installed.",
  "tools.detail.setup.info.langfuse.title": "Langfuse observability component",
  "tools.detail.setup.info.langfuse.description":
    "Installs and enables the Langfuse integration for recording Agent traces.",
  "tools.detail.setup.info.langfuse.detail.sdk":
    "Installs the Langfuse SDK into the Hermes Python environment.",
  "tools.detail.setup.info.langfuse.detail.plugin":
    "Enables the bundled observability/langfuse plugin in Hermes configuration.",
  "tools.detail.setup.info.langfuse.detail.restart":
    "Hermes must be restarted after setup before the tracing configuration takes effect.",
  "tools.detail.setup.info.xaiGrok.title": "Connect xAI",
  "tools.detail.setup.info.xaiGrok.description":
    "Chooses an available authentication method for tools that use xAI.",
  "tools.detail.setup.info.xaiGrok.detail.oauth":
    "You can open a browser and sign in with xAI Grok OAuth, using a compatible subscription allowance.",
  "tools.detail.setup.info.xaiGrok.detail.key":
    "Alternatively, save an XAI_API_KEY and use the billing of that xAI API account.",
  "tools.detail.setup.info.xaiGrok.detail.install":
    "This step installs no local executable or browser engine.",
  "tools.detail.setup.info.unknown.title": "Additional setup",
  "tools.detail.setup.info.unknown.description":
    "Hermes declares that this service needs an additional setup step.",
  "tools.detail.setup.info.unknown.detail":
    "This Hermes version did not provide structured details for the setup; its result will be shown when it runs.",
  "tools.detail.auth.title": "Sign in required",
  "tools.detail.auth.description":
    "This option uses your Nous account. Sign in from the Models page, then come back and refresh.",
  "tools.detail.model.title": "Choose a model",
  "tools.detail.model.description":
    "Models differ in speed, quality and price. The recommended default is preselected.",
  "tools.detail.model.save": "Use this model",
  "tools.detail.terminal.title": "Choose where commands run",
  "tools.detail.terminal.description":
    "This computer is best for beginners. Use an isolated container for unfamiliar code.",
  "tools.detail.terminal.ready": "Ready",
  "tools.detail.terminal.needsSetup": "Needs setup",
  "tools.detail.terminal.unavailable": "Unavailable",
  "tools.detail.terminal.connectionTitle": "Backend settings",
  "tools.detail.terminal.connectionDescription":
    "Only values required by the selected backend are shown. Existing secrets stay hidden.",
  "tools.detail.computer.title": "System control permissions",
  "tools.detail.computer.description":
    "Computer control needs a driver and operating-system approval. Amiba only uses it when a task requires it.",
  "tools.detail.computer.driver": "Computer control driver",
  "tools.detail.computer.accessibility": "Accessibility permission",
  "tools.detail.computer.screen": "Screen Recording permission",
  "tools.detail.computer.ready": "The driver and system permissions are ready",
  "tools.detail.computer.grant": "Request system permissions",
  "tools.detail.computer.requested":
    "Approve CuaDriver in the macOS system prompt, then choose Check again.",
  "tools.detail.computer.installFirst":
    "Install the computer control driver above, then grant system permissions.",
  "tools.detail.refresh": "Check again",
  "tools.detail.mutationFailed": "Could not save: {error}",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
