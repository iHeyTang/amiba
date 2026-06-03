# hermes-x

Multi-target workspace for Hermes:

- `apps/browser-extension` — browser extension (Plasmo, copied from `hermes-my-browser-extension`)
- `apps/desktop` — desktop app (Electron + Vite + React)
- `packages/platform` — `PlatformAdapter` interface (storage / runtime / tabs / scripting / bookmarks / history / windows / notifications / shell)
- `packages/utils` — pure helpers (`cn`, `formatBytes`, `shortId`, `safeJsonStringify`)
- `packages/ui` — shadcn React primitives + `styles/tokens.css` (HSL palette + base layer + Radix ScrollArea fixes)
- `packages/i18n` — locale catalogs + `useT()` hook, persists via adapter
- `packages/theme` — `useStoredThemePreference` / `useResolvedTheme` / `useDocumentTheme`, persists via adapter
- `packages/tailwind-preset` — shared Tailwind preset (shadcn color tokens, radius, font stack, `darkMode: class`)

The four sibling directories at the parent (`hermes-agent`, `hermes-my-browser-extension`, `hermes-plugin-browser-tools`, `hermes-plugin-http-backplane`) are **not** part of this workspace and remain untouched.

## Layout

```
hermes-x/
├── apps/
│   ├── extension/        # Plasmo Chrome extension
│   └── desktop/          # Electron app
├── packages/             # shared code (added in phase 2)
├── package.json          # workspace root
└── pnpm-workspace.yaml
```

## Prerequisites

- Node ≥ 20
- pnpm ≥ 9 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)

## Install

```bash
pnpm install
```

## Develop

```bash
pnpm dev:extension   # Plasmo dev (loads unpacked to chrome://extensions)
pnpm dev:desktop     # Electron + Vite HMR
```

## Build

```bash
pnpm build:extension
pnpm build:desktop
```

---

## Architecture

Both apps will eventually consume the same React UI + core logic from `packages/`. The only platform-specific code is a thin **PlatformAdapter** implementation:

```
shared UI / business
        │
        ▼
  PlatformAdapter (interface)
        │
   ┌────┴────┐
   ▼         ▼
 chrome.*  Electron IPC
(extension)  (desktop)
```

The adapter surface lives at `apps/desktop/src/renderer/platform/adapter.ts` (will move to `packages/platform` in phase 2). It covers the 9 `chrome.*` sub-APIs the extension currently uses: `storage`, `runtime`, `tabs`, `scripting`, `bookmarks`, `history`, `windows`, `notifications`, plus a generic `shell`.

### Desktop IPC

- `src/main/index.ts` — main process, creates `BrowserWindow` with `contextIsolation: true` and a preload script.
- `src/main/ipc.ts` — handlers for the bridge calls (currently `storage:*` and `shell:open-external`).
- `src/preload/index.ts` — exposes `window.hermes` via `contextBridge`.
- `src/renderer/platform/electron.ts` — adapter implementation backed by `window.hermes`.

## Migration roadmap

Phase 1 — scaffolding (done):
- [x] Monorepo root (`pnpm-workspace.yaml`, root `package.json`)
- [x] `apps/browser-extension` = verbatim copy of original extension (renamed to `@hermes-x/browser-extension`)
- [x] `apps/desktop` = Electron + Vite + React shell with placeholder Chat/Settings routes
- [x] `PlatformAdapter` interface + Electron implementation skeleton

Phase 2a — foundation extraction (done, strangler-fig: extension still has its originals):
- [x] `packages/platform` — `PlatformAdapter` interface, including `storage.watch()` for live updates.
- [x] `packages/utils` — `cn`, `formatBytes`, `shortId`, `safeJsonStringify`.
- [x] `packages/ui` — 14 shadcn primitives (Button, Card, Select, …). `cn` resolved via `@hermes-x/utils`.
- [x] `packages/i18n` — `en` + `zh-CN` catalogs + `useT()`. Persists via `getPlatform().storage`.
- [x] Desktop IPC: `storage.watch()` backed by main-process broadcast on every `storage:set` / `storage:remove`.
- [x] `apps/desktop` consumes all four packages; Settings page edits language live, Chat page reacts via `storage.watch()`.

Phase 2b-1 — UI shell parity (done):
- [x] `packages/theme` — extracted from `lib/theme.ts`, chrome → adapter.
- [x] `packages/tailwind-preset` — extracted from extension's `tailwind.config.js`.
- [x] `packages/ui/styles/tokens.css` — extracted HSL palette + `@layer base` + Radix ScrollArea fixes from extension's `style.css`. Chat-specific styling (`.chat-md`, `.tabbar-scroller`, `#__plasmo`) stays per-app.
- [x] `apps/desktop` consumes preset + tokens, calls `useResolvedTheme()` at the app root, pages use semantic tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-sidebar`, `border-border`). Settings page exposes Language + Theme selectors.

Phase 2b-2 — migrate extension to consume packages (done):
- [x] `apps/browser-extension/package.json` adds `@hermes-x/{platform,utils,ui,i18n,theme,tailwind-preset}` workspace deps.
- [x] `apps/browser-extension/src/lib/platform/chrome-adapter.ts` maps `PlatformAdapter` → `chrome.*`; `init.ts` calls `setPlatform()` once.
- [x] Every entry (`sidepanel/index.tsx`, `options/index.tsx`, `newtab/index.tsx`, `tabs/chat.tsx`) imports `~lib/platform/init` as its first line.
- [x] 26 files codemodded to import from `@hermes-x/*`. Zero `~lib/utils` / `~components/ui/*` / `~lib/i18n` / `~lib/theme` references remain.
- [x] `apps/browser-extension/tailwind.config.js` is now just `presets + content`. `style.css` is `@tailwind` + `@import "@hermes-x/ui/styles/tokens.css"` + surface-specific blocks.
- [x] Duplicated sources deleted: `components/ui/*`, `lib/utils.ts`, `lib/i18n/`, `lib/theme.ts`.

Phase 2c-1 — refactor storage-portable lib modules in place (done):
- [x] `lib/attachments/read.ts`, `lib/sessions/{store,migrate,use-sessions}.ts`, `lib/wallpaper/use-wallpaper.ts`, `lib/backplane-client.ts` — `chrome.storage.local.*` + `chrome.runtime.sendMessage` swapped to `getPlatform().storage` / `.runtime.sendMessage`.
- [x] `chrome.storage.onChanged.addListener` watcher pattern → `getPlatform().storage.watch(keys, cb)` returning `unsub`. (`use-sessions.ts` lines 250–296, `use-wallpaper.ts` lines 290–305.)
- [x] These modules now compile in either runtime — moving them to `packages/core` is a cp away.

Phase 2c-2 — extension-only modules stay on chrome.*:
- `lib/home-shortcuts/use-home-shortcuts.ts` (bookmarks CRUD + events).
- `lib/page-context/{capture,use-active-tab}.ts` (chrome.scripting / chrome.tabs.* events).
- `lib/quick-actions/index.ts` (browser tabs + bookmarks).
- Rationale: these features have no desktop counterpart. Bloating `PlatformAdapter` with bookmark/tabs-events methods would just produce `notImpl` stubs in `ElectronAdapter`. Better surfaced via `getPlatform().kind === "extension"` branching at call sites if a feature ever needs to coexist.

Phase 3a — chat domain layer (done):
- [x] `packages/core` with chat domain types: `ChatMessage`, `SessionMeta`, gateway wire protocol (`HermesToolProgress`, `HermesApprovalRequest`, …), engine ↔ UI protocol (`SubmitPayload`, `StreamEvent`, `SnapshotFrame`, `ChatRuntimeState`, …).
- [x] `ChatEngineClient` interface — transport-agnostic surface the UI uses to talk to its engine.
- [x] Extension's `lib/types.ts` / `lib/chat/hermes-client.ts` / `background/chat/types.ts` re-export from `@hermes-x/core` for back-compat.

Phase 3b — chat-ui (done, lightweight desktop-ready shell):
- [x] `packages/chat-ui` with `TabBar`, `SessionDrawer`, `MessageList`, `Composer`, `EmptyState`, and a composing `ChatView`.
- [x] `<ChatView>` takes a `client: ChatEngineClient` plus session state, with `composerExtrasAbove` and `headerExtras` slots for extension-only widgets (BridgeStatusBar / NavigateOpenPolicyToggle / Learn / page-context chip).
- [x] `apps/desktop` mounts `<ChatView>` with a stub `ElectronChatEngineClient`. Each "send" appends a placeholder assistant reply; sessions persist in renderer memory across tabs. Real Electron-main chat engine is the next-phase product work.

Phase 3c — visual identity lift (done):
- [x] `packages/core/config.ts` + `backplane-client.ts` — shared endpoint constants + the local-backplane HTTP entry point. Extension's `lib/backplane-client.ts` and `background/config.ts` re-export.
- [x] `packages/core/attachments/` — `types.ts`, `format.ts`, `read.ts` (770 LOC). Extension's `lib/attachments/*` re-export.
- [x] `packages/ui/HermesLogo.tsx` — brand mark, both PNG variants inlined as base64 (~48 KB) so the asset works in any bundler with no special loader. Extension's `components/hermes-logo.tsx` re-exports.
- [x] `packages/chat-ui/internal/types.ts` — `UiMessage`, `AssistantTimelineItem`, `ChatError`, `MessagesMaxWidth`, height constants.
- [x] `packages/chat-ui/internal/helpers.ts` — `bubbleTextContent`, `splitThinkingFromBody`, `formatToolDuration`, `hostnameOf`.
- [x] `packages/chat-ui/bubble/*.tsx` — all 17 sub-components (Bubble, MessageTurns, UserStickyBubble, EmptyState, ErrorBlock, AgentDestinationChip, PageChip, AttachmentChip, KindIcon, AttachmentBadgeView, ToolChip, ToolProgressChips, ApprovalBanner, ApprovalCountdownBar, ApprovalRecordChip, ApprovalRecordList). Streamdown markdown renderer + tool/approval timeline + assistant-bubble identity intact.
- [x] `AgentDestinationChip` parameterised via `onOpen` prop (extension wires `chrome.windows + chrome.tabs`; desktop wires `getPlatform().shell.openExternal`).
- [x] Extension's `sidepanel/index.tsx` dropped from 4199 → ~2810 lines (17 sub-components + 3 helpers + 5 inline types deleted; chat-ui imports added). `pnpm tsc --noEmit` exit=0, `plasmo build` exit=0.
- [x] Desktop's `<Chat />` page renders `<ChatView>` with `MessageTurns` + `Bubble` + `Streamdown`. Visual identity matches extension chat surface. `electron-vite build` exit=0 (2010 modules, renderer 1.74 MB + 44 KB CSS).

Phase 3c — extension migration to `<ChatView>` (deferred):
- [ ] Extension's `sidepanel/index.tsx` (4199 LOC monolith) still uses its own JSX. Migrating it onto `<ChatView>` means decomposing every state variable that today lives in the `SidePanel` function, plus building a `ChromeChatEngineClient` that wraps `chrome.runtime.connect({ name: CHAT_PORT_NAME })`. This is a substantial PR on its own; deferring until the desktop chat engine is real so both surfaces can co-evolve.
- [ ] When tackled: TabBar / SessionDrawer / MessageList already shared; the lift focuses on Composer wiring (Learn/page-context slots), BridgeStatusBar header slot, and the assistant-bubble renderer (currently uses Streamdown + intricate tool/approval timeline).
- [ ] Options panes (Gateway / Skills / Memory / Cron / Logs / Preferences / Status / Models) → `packages/settings-ui` is a separate sweep.

Phase 3e — 1:1 chat-surface lift (done):
- [x] `useSessions` hook + `store` + `migrate` (~1430 LOC) lifted to `packages/core/sessions-runtime/`.
- [x] 7 `hermes-*` backplane clients (sessions, memory, cron, logs, skills, lifecycle, agent-model) lifted to `packages/core/`.
- [x] Capability interfaces in `packages/chat-ui/src/internal/capabilities.ts`: PageContextCapability / LearnCapability / NavigateOpenPolicyCapability / PendingPromptCapability — all optional.
- [x] **Entire SidePanel function (4199 → 2752 → 2762 LOC) lifted** to `packages/chat-ui/src/SidePanelView.tsx`. All ~30 chrome.* sites replaced with capability/client/prop calls. Extension-only UI (Learn buttons, BridgeStatusBar, NavigateOpenPolicyToggle, page-context chips) gated by capability presence + slot props.
- [x] `apps/browser-extension/src/lib/chat/chrome-engine-client.ts` — wraps `chrome.runtime.connect({ name: CHAT_PORT_NAME })` as ChatEngineClient.
- [x] `apps/browser-extension/src/lib/chat/chrome-capabilities.ts` — chrome impls of all 4 capabilities + `openAgentDestinationInUserWindow` helper.
- [x] **`apps/browser-extension/src/sidepanel/index.tsx` reduced from 2752 to 56 LOC** — pure wrapper that builds ChromeChatEngineClient + chromeCapabilities + BridgeStatusBar/NavigateOpenPolicyToggle slots, renders `<SidePanelView>`.
- [x] **`apps/desktop/src/renderer/App.tsx` is 36 LOC** — `<SidePanelView client={ElectronChatEngineClient} capabilities={{}} ...>`. No left rail, no nav, no custom Composer. Visual identity 1:1 with extension's sidepanel.
- [x] Multi-window desktop: chat in main BrowserWindow, settings opens via `window.hermes.settings.open()` IPC → new BrowserWindow loading `options.html` (placeholder until Options panes lift).
- [x] electron-vite multi-entry rollup config (chat + options entries).
- [x] Self-verify: 8 packages tsc exit=0, extension tsc + plasmo build exit=0, desktop tsc + electron-vite build exit=0 (2020 modules, two HTML entries, chat 1.21 MB + options 1.7 KB + shared globals 574 KB + CSS 47 KB). Zero chrome.* code references in `packages/` (all hits are doc comments).

Phase 3f — Options/Settings 1:1 lift (done):
- [x] `packages/settings-ui` — new package, 12 files (~6700 LOC):
  - `HermesModelConfigTab` (1959 LOC) + `SettingsCron` (911) + `SettingsSkills` (995) + `SettingsStatus` (549) + `SettingsLogs` (389) + `SettingsPreferences` (580) + `SettingsMemory` (196) + `SettingsGateway` (200) — all 8 settings panes.
  - `ScriptEditor` (168) + `ScriptList` (88) — userscript management UI (capability-gated).
  - `SettingsView.tsx` — main tab container (sidebar nav + content router). Scripts tab hides when `userscripts` capability absent.
  - `capabilities.ts` — `BridgeCapability` + `UserScriptCapability` + composed `OptionsCapabilities`.
- [x] Additional lifts to `@hermes-x/core` to support settings-ui: `fetch-models` + `quick-actions` (chrome.storage → getPlatform().storage including `.watch()`).
- [x] `apps/browser-extension/src/options/index.tsx` reduced from 507 → 20 LOC (`<SettingsView capabilities={chromeOptionsCapabilities} />`).
- [x] `apps/browser-extension/src/lib/options/chrome-capabilities.ts` — `chrome.runtime.sendMessage` impls for userscript CRUD + `bridge.refresh`.
- [x] `apps/desktop/src/renderer/options.tsx` (29 LOC) — `<SettingsView capabilities={{}} />`. Scripts tab + bridge refresh hidden automatically.
- [x] Tailwind content paths updated in both apps to scan settings-ui.
- [x] Self-verify: 9 packages tsc exit=0, extension tsc + plasmo build exit=0, desktop tsc (renderer + main) + electron-vite build exit=0 (2051 modules, chat 1.11 MB + options 988 KB + shared globals 678 KB + CSS 56 KB).
- [x] packages/ has zero non-comment chrome.* code references.

Phase 3d — desktop chat engine (done):
- [x] `packages/core/hermes-client.ts` — HermesClient + streamChat + runHermesAgent + postHermesApprovalDecision lifted from extension. Single source of truth for the HTTP/SSE gateway protocol; extension's `lib/chat/hermes-client.ts` is now a one-line re-export.
- [x] `apps/desktop/src/main/storage.ts` — single in-process file-backed store shared by the main-side PlatformAdapter and the renderer-IPC storage handlers.
- [x] `apps/desktop/src/main/platform.ts` — `createMainPlatformAdapter()` so `backplaneFetch` / HermesClient can read `settings.backplane.key` from main without IPC.
- [x] `apps/desktop/src/main/chat/engine.ts` — per-session ChatRuntimeState in a Map; calls `streamChat` on submit and forwards every gateway event through `webContents.send('chat:engine-to-client', …)`.
- [x] `preload/index.ts` exposes `window.hermes.chat = { send, onMessage }`. `ElectronChatEngineClient` (renderer) wraps it as a real ChatEngineClient — protocol identical to extension's chrome.runtime port client.
- [x] `apps/desktop/src/renderer/pages/Chat.tsx` — drives `UiMessage[]` from `client.onStreamEvent(...)`. Maps `chunk → content`, `reasoning → reasoning`, `hermesToolProgress → chips + timeline`, `approvalRequest → audit trail`, `done/aborted/error → finalize`. Mirrors the extension's `handleStreamEvent` minus queue / page-context / Learn (those are extension-only).

Phase 3e — extension-only modules stay put:
- `lib/page-context/*`, `lib/home-shortcuts/*`, `lib/quick-actions/*`, `lib/userscript/*`, `background/*` — browser-only by nature; not migrated, not extracted. Surfaced into chat-ui via the slot props on `<ChatView>`.

Phase 3f — desktop-only future surfaces (not started):
- [ ] System tray + global hotkeys.
- [ ] Native file picker for attachments (instead of the extension's page-context-capture).
- [ ] Auto-update via `electron-updater`.

Phase 3 — UI parity:
- [ ] `apps/desktop` renders the chat panel from `packages/ui/chat` at `/chat`.
- [ ] `apps/desktop` renders the settings panes from `packages/ui/settings` at `/settings/*`.

Phase 4 — desktop polish:
- [ ] App icon + electron-builder targets (mac dmg, win nsis, linux AppImage).
- [ ] Auto-update via `electron-updater`.
- [ ] Native menu, tray, global shortcuts.
