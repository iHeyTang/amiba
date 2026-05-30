import { fileURLToPath } from "node:url"
import path from "node:path"
import type net from "node:net"
import { BrowserWindow, app, ipcMain, nativeImage, session, shell } from "electron"
import { setPlatform } from "@hermes-x/platform"

// Process-level safety nets. Without these, an unhandled rejection inside
// any async path (storage I/O, cron-watcher tick, IPC handler) can leave
// the process in "deprecated future-throw" mode where Node may terminate
// or behave inconsistently across versions. We log + continue so the
// user's main window stays alive while we surface the bug.
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason)
})
process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err)
})

import { registerChatHandlers, resolveApproval } from "./chat/engine"
import { startCronWatcher, stopCronWatcher } from "./cron-watcher"
import {
  createNotifierWindow,
  destroyNotifierWindow,
  showDemoNotifier,
} from "./notifier-window"
import {
  createQuickAskWindow,
  destroyQuickAskWindow,
  hideQuickAsk,
  resizeQuickAsk,
  summonQuickAsk,
} from "./quick-ask-window"
import {
  attachSecondInstanceHandler,
  registerProtocolHandler,
  startUnixSocketInbox,
  stopUnixSocketInbox,
} from "./external-inbox"
import {
  registerHermesRuntimeHandlers,
  stopAllHermesJobs,
} from "./hermes-runtime"
import { startHotkeyManager, stopHotkeyManager } from "./hotkey"
import { registerIpcHandlers } from "./ipc"
import { createMainPlatformAdapter } from "./platform"
import { cleanupOldSnips } from "./screen-capture"
import { startWorkspaceManager, stopWorkspaceManager } from "./workspace"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL
const IS_MAC = process.platform === "darwin"

/**
 * Resolve the app icon shipped under `apps/desktop/resources/icon.png`.
 * Path is relative to the built `out/main/index.js` in production
 * (`out/main/../resources` resolves to `out/resources`, which doesn't
 * exist by default — electron-builder copies it via `extraResources`),
 * and relative to project root in dev (we resolve from app.getAppPath()
 * which points at `apps/desktop` in dev mode).
 */
function iconPath(): string {
  return path.join(app.getAppPath(), "resources", "icon.png")
}

/**
 * Cross-origin endpoints the renderer needs to fetch + paint into a
 * `<canvas>` (so they need `Access-Control-Allow-Origin: *` AND
 * `tainted-canvas`-safe response headers).
 *
 *   - bing.com / bing.net  — Bing wallpaper feed (`HPImageArchive.aspx`)
 *                            plus the actual image CDN.
 *
 * Browser extensions get this for free via `host_permissions`; Electron
 * renderers go through normal CORS, and Bing doesn't ship CORS headers
 * on these endpoints. We rewrite the response headers here in main so
 * the renderer's fetch + canvas measureLuminance() work unchanged.
 */
const CORS_BYPASS_URL_PATTERNS = [
  "https://www.bing.com/*",
  "https://*.bing.net/*",
  "https://*.bing.com/*",
]

function installCorsBypass() {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: CORS_BYPASS_URL_PATTERNS },
    (details, callback) => {
      const headers = { ...(details.responseHeaders ?? {}) }
      // Strip whatever upstream sent so our injected header wins.
      for (const k of Object.keys(headers)) {
        const norm = k.toLowerCase()
        if (
          norm === "access-control-allow-origin" ||
          norm === "access-control-allow-credentials"
        ) {
          delete headers[k]
        }
      }
      headers["Access-Control-Allow-Origin"] = ["*"]
      callback({ responseHeaders: headers })
    }
  )
}

/**
 * Bring the main window forward when the user hits the global shortcut.
 *
 * Behavior covers every realistic state:
 *   - no live window     → create one (covers macOS, where closing the
 *                          last window doesn't quit the app — without
 *                          this branch the hotkey appears to "die" once
 *                          the user hits the red traffic light)
 *   - minimized          → restore + focus
 *   - hidden (Cmd+H)     → show + focus
 *   - background         → focus (raise to front)
 *   - already focused    → no-op (avoids stealing focus from itself)
 */
function summonWindow() {
  const live = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!live) {
    createWindow()
    return
  }
  if (live.isMinimized()) live.restore()
  if (!live.isVisible()) live.show()
  if (!live.isFocused()) live.focus()
}

/**
 * Quick-Ask Spotlight summon. We deliberately do NOT try to capture the
 * user's current text selection or clipboard image — the synthesized
 * ⌘C / pasteboard snapshot dance was fragile (NSPanel focus quirks,
 * clipboard clobber, ~150ms latency on every hotkey press) and ended
 * up costing more in surprise than it bought in convenience. The popup
 * just opens; the user pastes whatever they want with ⌘V.
 *
 * The popup window is positioned on the display under the cursor (see
 * `quick-ask-window.ts` → `computeBounds`) so multi-monitor users get
 * it on the screen they were just typing on, not the primary one.
 */
function summonQuickAskFromHotkey(): void {
  summonQuickAsk({})
}

/**
 * Wire the renderer-side actions from the Heads-up Notifier back to main:
 *
 *   - `notifier:activate-main` — clicking the cron-completed card raises
 *     the primary window via the same `summon` flow the hotkey uses.
 *   - `notifier:approve` / `notifier:deny` — forward the verdict to the
 *     chat engine so the gateway's pending approval resolves.
 */
function registerNotifierIpcHandlers(summon: () => void): void {
  ipcMain.handle("notifier:activate-main", () => {
    summon()
  })
  // Manual demo trigger so users can confirm the notifier window
  // appears + clicks register without having to provoke a real
  // approval or wait for a cron run. Exposed via the preload bridge as
  // `window.hermes.notifier.demo(kind?)`.
  ipcMain.handle(
    "notifier:demo",
    (_e, kind?: "cron-completed" | "approval-pending") => {
      showDemoNotifier(kind ?? "cron-completed")
    },
  )
  ipcMain.handle("notifier:approve", (_e, approvalId: string) => {
    resolveApproval(approvalId, "approve")
  })
  ipcMain.handle("notifier:deny", (_e, approvalId: string) => {
    resolveApproval(approvalId, "deny")
  })
}

/**
 * Quick-Ask Spotlight popup back-channels: dismiss + dynamic resize.
 * The popup gets streaming chat via the existing `chat:client-to-engine`
 * IPC like any other surface, so we only need to expose the window-
 * level ops here.
 */
function registerQuickAskIpcHandlers(): void {
  ipcMain.handle("quick-ask:dismiss", () => {
    hideQuickAsk()
  })
  ipcMain.handle("quick-ask:resize", (_e, contentHeightPx: number) => {
    if (typeof contentHeightPx === "number" && Number.isFinite(contentHeightPx)) {
      resizeQuickAsk(contentHeightPx)
    }
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    // Onboarding sets the floor here. With the hero (logo + 2-line
    // tagline + 2-line subtitle) and CTA visible plus a comfortable
    // gap to the collapsed manual disclosure at the bottom, the page
    // sits around 560px of content; 800 gives generous breathing room.
    // Expanded manual recipes overflow the page-level scroll cleanly
    // (see SummaryBlock — `overflow-y-auto` + `mt-auto`), so this
    // doesn't need to inflate to fit the worst case.
    minHeight: 800,
    title: "Hermes",
    backgroundColor: "#0b0b0b",
    icon: IS_MAC ? undefined : iconPath(),
    // Immersive title bar. macOS uses `hidden` (not `hiddenInset`) so we
    // can drive the traffic-light position ourselves via
    // `trafficLightPosition` — `hiddenInset` silently ignores it.
    //
    // 40px title-bar row with traffic lights pinned at (20, 14): the
    // 12-14px dot cluster sits with its vertical centre on y=20, and
    // an h-6 button centred in the 40px row also lands on y=20, so
    // every custom affordance shares the lights' baseline pixel-for-
    // pixel. Earlier attempts (24/36px rows with smaller y) consistently
    // floated the custom buttons above the lights because AppKit clamps
    // small y values and the dots themselves render slightly taller than
    // their nominal 12px on retina.
    titleBarStyle: "hidden",
    trafficLightPosition: IS_MAC ? { x: 20, y: 14 } : undefined,
    titleBarOverlay: IS_MAC
      ? false
      : { color: "#0b0b0b", symbolColor: "#e7e7e7", height: 44 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  if (isDev && RENDERER_DEV_URL) {
    win.loadURL(RENDERER_DEV_URL)
    // DevTools auto-open is opt-in via env so it stays out of the
    // user's face by default. Set `HERMES_DEVTOOLS=1` in the env to
    // reopen them automatically; otherwise pop them with
    // ⌘⌥I / Ctrl+Shift+I when you actually need them.
    if (process.env.HERMES_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" })
    }
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"))
  }
}

// Single-instance lock. Without this, win/linux protocol launches
// (`hermes-x://...` from the OS) spawn a fresh Electron process every
// time — the second copy has no hotkey, no chat engine, no shared
// store. With the lock held, every retry funnels through the
// `second-instance` event on the original process, which is exactly
// where we want the URL to land.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // Another Hermes instance already owns this user's session — its
  // `second-instance` handler will pick up our argv (including any
  // hermes-x:// URL) and surface the prompt over there. Bail.
  app.quit()
} else {
  attachSecondInstanceHandler(summonWindow)

  let inboxServer: net.Server | null = null

  app.whenReady().then(async () => {
    // Install the main-process PlatformAdapter BEFORE registering any handler
    // that imports backplaneFetch / HermesClient — those call getPlatform() at
    // request time and need the adapter wired up first.
    setPlatform(createMainPlatformAdapter())
    // Workspace restore reads `mainStore` which can fail (corrupted
    // hermes-store.json, permission denied, etc). DO NOT let that take
    // the whole app down: a failed restore should still leave the user
    // with a working main window. They can re-bind a workspace by
    // dragging a folder into the chat panel later.
    try {
      await startWorkspaceManager()
    } catch (err) {
      console.error("[main] workspace init failed; continuing without restore:", err)
    }
    // Best-effort cleanup of stale snip PNGs from previous runs. Fire-
    // and-forget so a slow disk doesn't delay the window appearing.
    void cleanupOldSnips()
    installCorsBypass()
    registerIpcHandlers()
    registerChatHandlers()
    registerHermesRuntimeHandlers()
    createWindow()
    createNotifierWindow()
    // Pre-create the Quick-Ask popup so the first double-tap doesn't
    // pay BrowserWindow construction + renderer boot latency (~400ms
    // cold). Hidden by default; surfaces via `summonQuickAsk` on
    // hotkey.
    createQuickAskWindow()
    // macOS dock icon. We pin it twice:
    //   1. NOW — after panel + main + notifier windows have all been
    //      created and any activation-policy transitions have flushed.
    //   2. On `app.on("activate", …)` and again on a short timeout —
    //      macOS sometimes refreshes the dock from the bundle's .icns
    //      after window state settles, undoing our runtime override.
    //      Re-applying covers those resets.
    if (IS_MAC && app.dock) {
      const pinDockIcon = () => {
        try {
          const img = nativeImage.createFromPath(iconPath())
          if (!img.isEmpty()) app.dock!.setIcon(img)
        } catch (err) {
          console.warn("[hermes-x] dock icon load failed:", err)
        }
      }
      pinDockIcon()
      // Belt-and-braces re-pin after the first event loop tick — covers
      // the case where macOS resets the dock icon as part of finishing
      // the panel window's setup (which we observed: setIcon succeeds
      // synchronously but the dock still shows the Electron default).
      setTimeout(pinDockIcon, 200)
      app.on("activate", pinDockIcon)
    }
    registerNotifierIpcHandlers(summonWindow)
    registerQuickAskIpcHandlers()
    // Poll the gateway for new cron-run completions and push them to
    // the Heads-up Notifier. The watcher tolerates a not-yet-ready
    // backplane (silent retry every 30s) so it's safe to start before
    // the onboarding wizard has actually launched `hermes gateway`.
    startCronWatcher()

    // Load the persisted summon-hotkey config and start listening. The
    // manager subscribes to renderer writes too, so changes from the
    // Preferences panel take effect without a restart.
    //
    // Quick-Ask hotkey just opens the popup — no selection capture, no
    // clipboard reads. Users paste their own context with ⌘V. The snip
    // hotkey (⌘⇧.) takes the raw `summonWindow` because by the time we
    // raise the main window the snip flow has already written its own
    // pendingPrompt.
    void startHotkeyManager(summonQuickAskFromHotkey, summonWindow)

    // External entry points: OS-level `hermes-x://` URLs and the local
    // Unix socket inbox. Both write `home.pendingPrompt` and summon the
    // window; the renderer's existing watcher routes to chat.
    registerProtocolHandler(summonWindow)
    try {
      inboxServer = await startUnixSocketInbox(summonWindow)
    } catch (err) {
      console.error("[main] failed to start inbox socket:", err)
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on("will-quit", () => {
    void stopUnixSocketInbox(inboxServer)
    inboxServer = null
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// Electron docs explicitly require us to release global shortcuts before
// quitting; otherwise they can linger on Windows + Linux after the
// process exits and the next launch can't reclaim them. Same goes for
// the uiohook hook used by double-tap mode.
app.on("will-quit", () => {
  stopHotkeyManager()
  stopCronWatcher()
  destroyNotifierWindow()
  destroyQuickAskWindow()
  stopAllHermesJobs()
  void stopWorkspaceManager()
})
