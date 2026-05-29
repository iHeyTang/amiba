import { fileURLToPath } from "node:url"
import path from "node:path"
import type net from "node:net"
import { BrowserWindow, app, ipcMain, nativeImage, session, shell } from "electron"
import { setPlatform } from "@hermes-x/platform"

import { registerChatHandlers, resolveApproval } from "./chat/engine"
import { createNotifierWindow } from "./notifier-window"
import {
  attachSecondInstanceHandler,
  deliverPrompt,
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
import { captureSelection } from "./selection"

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
 * Quick-Ask Spotlight summon: try to grab whatever text the user has
 * selected in their frontmost app first, then summon. If we got text,
 * route through `deliverPrompt` so the composer pre-fills via the same
 * channel HomeView's pendingPrompt watcher already drains. If we got
 * nothing (no selection, missing Accessibility grant, scripting timeout,
 * Windows / Linux), fall back to a plain summon.
 *
 * Must stay async-but-fire-and-forget for the hotkey manager, which
 * invokes its callback synchronously. The 120ms AppleScript delay means
 * users see a noticeable lag before the window appears when they DO
 * have a selection — that's intrinsic to the "synthesize ⌘C then read
 * the pasteboard" approach and acceptable for the first iteration.
 */
function summonWithSelection(): void {
  void (async () => {
    try {
      const sel = await captureSelection()
      if (sel) {
        await deliverPrompt(sel.text, summonWindow)
        return
      }
    } catch (err) {
      console.warn("[hermes-x] quick-ask capture failed; plain summon:", err)
    }
    summonWindow()
  })()
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
  ipcMain.handle("notifier:approve", (_e, approvalId: string) => {
    resolveApproval(approvalId, "approve")
  })
  ipcMain.handle("notifier:deny", (_e, approvalId: string) => {
    resolveApproval(approvalId, "deny")
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
    win.webContents.openDevTools({ mode: "detach" })
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
    installCorsBypass()
    // macOS: dock icon (window icon is set per-BrowserWindow above for
    // Windows/Linux; macOS reads it from the .icns inside the .app bundle
    // when packaged, and from `app.dock.setIcon` at runtime when dev'ing).
    if (IS_MAC && app.dock) {
      try {
        app.dock.setIcon(nativeImage.createFromPath(iconPath()))
      } catch {
        // best-effort — file may not exist in some packaged layouts
      }
    }
    registerIpcHandlers()
    registerChatHandlers()
    registerHermesRuntimeHandlers()
    createWindow()
    createNotifierWindow()
    registerNotifierIpcHandlers(summonWindow)

    // Load the persisted summon-hotkey config and start listening. The
    // manager subscribes to renderer writes too, so changes from the
    // Preferences panel take effect without a restart.
    //
    // Hotkey path uses `summonWithSelection` so the Quick-Ask Spotlight
    // flow gets a chance to pre-fill the composer with the user's
    // current text selection. Protocol / socket / second-instance paths
    // keep using raw `summonWindow` — they either carry their own
    // prompt already or aren't text-selection-driven.
    //
    // The snip hotkey (⌘⇧.) also takes the raw `summonWindow`: by the
    // time we raise the window the snip flow has already written its
    // own pendingPrompt, so re-running the selection-capture
    // AppleScript on top of it would only risk clobbering that prompt
    // with a stale clipboard read.
    void startHotkeyManager(summonWithSelection, summonWindow)

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
  stopAllHermesJobs()
})
