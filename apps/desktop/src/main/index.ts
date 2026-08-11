import { fileURLToPath } from "node:url"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import path from "node:path"
import type net from "node:net"
import {
  BrowserWindow,
  app,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
  systemPreferences,
} from "electron"
import { setPlatform } from "@amiba/platform"
import { backplaneFetch, getHermesSession, listHermesSessions } from "@amiba/core"
import { bootMainExtensionHost, registerExtHttpChannel, seedBundledExtensions } from "@amiba/extension-host/main"
import { startExtHttpServer } from "./ext-http-server"

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

import { registerChatHandlers, resolveApproval, setChatEventPublisher } from "./chat/engine"
import { startCronWatcher, stopCronWatcher } from "./cron-watcher"
import {
  createNotifierWindow,
  destroyNotifierWindow,
  hideNotifier,
  showDemoNotifier,
} from "./notifier-window"
import {
  createQuickAskWindow,
  destroyQuickAskWindow,
  hideQuickAsk,
  resizeQuickAsk,
  setQuickAskIgnoreMouseEvents,
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
import { recordToolActivityEvent, registerToolActivity } from "./tool-activity"
import { cleanupOldSnips } from "./screen-capture"
import { startWorkspaceManager, stopWorkspaceManager } from "./workspace"
import { mainStore } from "./storage"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL
const IS_MAC = process.platform === "darwin"

/**
 * Return the absolute path to the extensions root directory (where marketplace
 * installs land). The env override AMIBA_DEV_EXTENSIONS_PATH is still
 * honoured so `AMIBA_DEV_EXTENSIONS_PATH=... pnpm dev:desktop` can test
 * marketplace-style installs against a custom directory.
 *
 * The directory is created if it does not yet exist.
 */
function getExtensionsRoot(): string {
  const dir =
    process.env.AMIBA_DEV_EXTENSIONS_PATH ??
    join(app.getPath("userData"), "extensions")
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Return the absolute path to the extensions registry JSON file.
 * Always lives in <userData>/extensions-registry.json.
 */
function getRegistryPath(): string {
  return join(app.getPath("userData"), "extensions-registry.json")
}

/**
 * Extensions that ship WITH the app (default-installed). Each is built from
 * its own sibling repo; `dir` is both the sibling repo folder name (dev) and
 * the packaged resources subfolder name. Seeded into the registry at boot
 * (source: "bundled") so users get them without a marketplace install.
 *
 * Currently empty — Skills and Usage (ex skills / token-meter / tool-meter
 * extensions) are built-in native pages now (packages/ui/src/skills and
 * /usage). The seeding + pruning mechanism stays for future bundled exts;
 * ids removed from this list are pruned from the registry at boot.
 */
const BUNDLED_EXTS: { id: string; dir: string }[] = []

/**
 * Resolve a bundled extension's root dir (the folder with manifest.json +
 * dist/). Packaged: `resources/bundled-extensions/<dir>` (populated by
 * electron-builder `extraResources` — not yet wired; see the bundling TODO).
 * Dev: the sibling ext repo next to the `amiba` monorepo, overridable via
 * AMIBA_DEV_BUNDLED_EXTS_DIR for non-standard checkouts. app.getAppPath()
 * in dev is `amiba/apps/desktop`, so three levels up is the directory that
 * holds both `amiba/` and any sibling ext repos.
 */
function resolveBundledExtRoot(dir: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "bundled-extensions", dir)
  }
  const base =
    process.env.AMIBA_DEV_BUNDLED_EXTS_DIR ??
    join(app.getAppPath(), "..", "..", "..")
  return join(base, dir)
}

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
 * Permit ``media`` permission requests from the renderer so
 * ``navigator.mediaDevices.getUserMedia({ audio: true })`` reaches the
 * OS layer instead of being rejected at the Electron boundary. Also
 * permit ``clipboard-sanitized-write`` so the chat bubble's copy-code
 * button (Streamdown calls ``navigator.clipboard.writeText``) doesn't
 * silently reject — Streamdown swallows the rejection with no onError
 * handler, so denial here looks like a dead button in the UI.
 *
 * On macOS, the OS-level decision is still gated by
 * ``NSMicrophoneUsageDescription`` in Info.plist (declared via
 * ``build.mac.extendInfo`` in ``package.json`` for packaged builds,
 * Electron.app's own Info.plist in dev) AND the user's choice in
 * Privacy & Security → Microphone. Without this handler, Electron
 * defaults to silently denying media requests for navigated content
 * (file:// + dev http://), surfacing in the renderer as a
 * ``NotAllowedError: Permission denied`` — the exact failure the Voice
 * settings test was hitting.
 *
 * Other request kinds (notifications, geolocation, MIDI, …) fall
 * through to Electron's default handler.
 */
function installPermissionRequestHandler(): void {
  const allowed = new Set(["media", "clipboard-sanitized-write"])
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(allowed.has(permission))
    },
  )
  // Some Chromium APIs (clipboard.writeText among them) gate on the
  // synchronous check handler rather than the async request handler.
  // Mirror the same allowlist here so writeText doesn't get denied
  // before the request handler is ever consulted.
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => allowed.has(permission),
  )
}

/**
 * Renderer-facing IPC: ``voice:ensure-microphone-access`` triggers the
 * native permission flow without yet starting a recording. The renderer
 * calls this immediately before ``getUserMedia`` so that on macOS the
 * "Amiba wants to use the microphone" dialog appears (first call) or
 * the stored decision is returned (subsequent calls), and the renderer
 * can present a friendly hint when access is denied at the OS level
 * instead of the generic ``Permission denied`` string.
 *
 * Returns one of macOS's media-access-status strings:
 *   - ``"granted"`` — proceed with getUserMedia
 *   - ``"denied"`` / ``"restricted"`` — the user must flip the toggle
 *     in System Settings → Privacy & Security → Microphone
 *   - ``"not-determined"`` — only seen if the OS dialog was suppressed
 *     (very rare; treat as denied)
 *   - ``"unknown"`` — non-macOS platforms (Windows / Linux) where the
 *     check is a no-op; renderer should proceed and let getUserMedia
 *     report any failure.
 */
function registerVoicePermissionHandler(): void {
  ipcMain.handle(
    "voice:ensure-microphone-access",
    async (): Promise<"granted" | "denied" | "restricted" | "not-determined" | "unknown"> => {
      if (process.platform !== "darwin") return "unknown"
      const current = systemPreferences.getMediaAccessStatus("microphone")
      if (current === "granted") return "granted"
      if (current === "not-determined") {
        try {
          const ok = await systemPreferences.askForMediaAccess("microphone")
          return ok ? "granted" : "denied"
        } catch (err) {
          console.warn("[main] askForMediaAccess(microphone) failed:", err)
          return "denied"
        }
      }
      return current
    },
  )
}

// Track the main window explicitly. The notifier + quick-ask windows
// are persistent (hidden on dismiss, not destroyed), so any "find the
// main window" lookup via BrowserWindow.getAllWindows() would happily
// return one of them after the user closed the real main window via
// the red traffic light — breaking dock-icon reopen, hotkey summon,
// and protocol-URL handling.
let mainWindow: BrowserWindow | null = null
let startupWindowTheme: "light" | "dark" = nativeTheme.shouldUseDarkColors
  ? "dark"
  : "light"

// Extension HTTP server — started inside app.whenReady() once the
// registryPath is known. Stopped in before-quit alongside the extension host.
let _extHttpServer: import("./ext-http-server").ExtHttpServer | null = null

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
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  if (!mainWindow.isFocused()) mainWindow.focus()
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

/** Raise the primary window and route its renderer to a persisted session. */
function openSessionInMainWindow(
  rawSessionId: string,
  summon: () => void,
): boolean {
  if (typeof rawSessionId !== "string" || !rawSessionId.trim()) return false
  const sessionId = rawSessionId.trim()
  summon()

  const win = mainWindow
  if (!win || win.isDestroyed()) return false
  const send = () => {
    if (!win.isDestroyed()) {
      win.webContents.send("ui:open-session", { sessionId })
    }
  }
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once("did-finish-load", send)
  } else {
    send()
  }
  return true
}

/**
 * Wire the renderer-side actions from the Heads-up Notifier back to main:
 *
 *   - `notifier:open-session` — the explicit View action raises the primary
 *     window and asks its renderer to open the matching conversation.
 *   - `notifier:approve` / `notifier:deny` — forward the verdict to the
 *     chat engine so the gateway's pending approval resolves.
 */
function registerNotifierIpcHandlers(summon: () => void): void {
  ipcMain.handle("notifier:open-session", (_event, sessionId: string) => {
    if (!openSessionInMainWindow(sessionId, summon)) return
    hideNotifier()
  })
  ipcMain.handle("notifier:hide", () =>
    hideNotifier({ restorePreviousApp: true }),
  )
  // Manual demo trigger so users can confirm the notifier window
  // appears + clicks register without having to provoke a real
  // approval or wait for a cron run. Exposed via the preload bridge as
  // `window.amiba.notifier.demo(kind?)`.
  ipcMain.handle(
    "notifier:demo",
    (_e, kind?: "cron-completed" | "chat-completed" | "approval-pending") => {
      showDemoNotifier(kind ?? "cron-completed")
    },
  )
  ipcMain.handle("notifier:approve", (_e, approvalId: string) => {
    resolveApproval(approvalId, "approve")
    hideNotifier({ restorePreviousApp: true })
  })
  ipcMain.handle("notifier:deny", (_e, approvalId: string) => {
    resolveApproval(approvalId, "deny")
    hideNotifier({ restorePreviousApp: true })
  })
}

/**
 * Quick-Ask Spotlight popup back-channels: dismiss + dynamic resize.
 * The popup gets streaming chat via the existing `chat:client-to-engine`
 * IPC like any other surface, so we only need to expose the window-
 * level ops here.
 */
function registerQuickAskIpcHandlers(summon: () => void): void {
  ipcMain.handle("quick-ask:dismiss", () => {
    hideQuickAsk()
  })
  ipcMain.handle("quick-ask:open-in-main", (_e, sessionId: string) => {
    if (!openSessionInMainWindow(sessionId, summon)) return
    hideQuickAsk()
  })
  ipcMain.handle("quick-ask:set-ignore-mouse", (_e, ignore: boolean) => {
    setQuickAskIgnoreMouseEvents(ignore === true)
  })
  ipcMain.handle(
    "quick-ask:resize",
    (
      _e,
      contentHeightPx: number,
      anchor: "top" | "center" | "bottom" = "top",
    ) => {
      if (
        typeof contentHeightPx === "number" &&
        Number.isFinite(contentHeightPx)
      ) {
        resizeQuickAsk(
          contentHeightPx,
          anchor === "bottom" ? "bottom" : "top",
        )
      }
    },
  )
}

function createWindow() {
  const startupPalette =
    startupWindowTheme === "dark"
      ? {
          background: "#09090b",
          titleBarSymbol: "#e7e7e7",
        }
      : {
          background: "#ffffff",
          titleBarSymbol: "#18191b",
        }
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
    title: "Amiba",
    // Match the critical HTML shell exactly. Electron paints this native
    // color before Chromium parses index.html, eliminating the old black
    // frame that preceded the renderer's loading state.
    backgroundColor: startupPalette.background,
    icon: IS_MAC ? undefined : iconPath(),
    // Immersive title bar. macOS uses `hidden` (not `hiddenInset`) so we
    // can drive the traffic-light position ourselves via
    // `trafficLightPosition` — `hiddenInset` silently ignores it.
    //
    // 48px title-bar row with traffic lights pinned at (20, 18): the
    // ~12px dot cluster's vertical centre sits at y=24, and a header
    // action centred in the 48px row also lands at y=24, so every
    // custom affordance shares the lights' baseline pixel-for-pixel.
    // Keep ``TITLE_BAR_HEIGHT`` in App.tsx in sync with the height
    // value here and with the ``y`` here (``y = TITLE_BAR_HEIGHT/2 -
    // dotHeight/2``).
    titleBarStyle: "hidden",
    trafficLightPosition: IS_MAC ? { x: 20, y: 18 } : undefined,
    titleBarOverlay: IS_MAC
      ? false
      : {
          color: startupPalette.background,
          symbolColor: startupPalette.titleBarSymbol,
          height: 48,
        },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Required to allow <webview> tags in the renderer. Extension views
      // are hosted in isolated <webview> elements (file:// URLs) with
      // their own preload bridge — no node integration inside them.
      webviewTag: true,
    }
  })

  mainWindow = win
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  if (isDev && RENDERER_DEV_URL) {
    const rendererUrl = new URL(RENDERER_DEV_URL)
    rendererUrl.searchParams.set("startupTheme", startupWindowTheme)
    win.loadURL(rendererUrl.toString())
    // DevTools auto-open is opt-in via env so it stays out of the
    // user's face by default. Set `AMIBA_DEVTOOLS=1` in the env to
    // reopen them automatically; otherwise pop them with
    // ⌘⌥I / Ctrl+Shift+I when you actually need them.
    if (process.env.AMIBA_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" })
    }
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"), {
      query: { startupTheme: startupWindowTheme },
    })
  }
}

// Single-instance lock. Without this, win/linux protocol launches
// (`amiba://...` from the OS) spawn a fresh Electron process every
// time — the second copy has no hotkey, no chat engine, no shared
// store. With the lock held, every retry funnels through the
// `second-instance` event on the original process, which is exactly
// where we want the URL to land.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // Another Amiba instance already owns this user's session — its
  // `second-instance` handler will pick up our argv (including any
  // amiba:// URL) and surface the prompt over there. Bail.
  app.quit()
} else {
  attachSecondInstanceHandler(summonWindow)

  let inboxServer: net.Server | null = null

  app.whenReady().then(async () => {
    // Install the main-process PlatformAdapter BEFORE registering any handler
    // that imports backplaneFetch / HermesClient — those call getPlatform() at
    // request time and need the adapter wired up first.
    setPlatform(createMainPlatformAdapter())
    // Resolve the user's stored preference before the first BrowserWindow is
    // created so Electron's native canvas and the HTML critical shell paint
    // the same palette. "auto" follows the OS at launch.
    try {
      const storedTheme = (await mainStore.get("settings.ui.theme"))[
        "settings.ui.theme"
      ]
      startupWindowTheme =
        storedTheme === "light" || storedTheme === "dark"
          ? storedTheme
          : nativeTheme.shouldUseDarkColors
            ? "dark"
            : "light"
    } catch {
      startupWindowTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light"
    }
    // Workspace restore reads `mainStore` which can fail (corrupted
    // amiba-store.json, permission denied, etc). DO NOT let that take
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
    installPermissionRequestHandler()
    registerVoicePermissionHandler()
    registerIpcHandlers()
    registerChatHandlers()
    registerHermesRuntimeHandlers()
    registerToolActivity()

    const extensionsRoot = getExtensionsRoot()
    const registryPath = getRegistryPath()

    // Seed default-bundled extensions into the registry BEFORE the host
    // discovers it, so first launch (empty registry) still loads them.
    // Idempotent + version-aware; preserves the user's enable/disable choice.
    const seedResult = seedBundledExtensions(
      registryPath,
      BUNDLED_EXTS.map((b) => ({ id: b.id, root: resolveBundledExtRoot(b.dir) })),
    )
    console.info("[main] bundled-ext seed:", JSON.stringify(seedResult))

    // Start the local HTTP server that serves extension WebView assets.
    // Bound to loopback only (127.0.0.1), OS-assigned port.
    const extHttpServer = await startExtHttpServer({ registryPath })
    _extHttpServer = extHttpServer
    console.info(`[main] extension http server listening at ${extHttpServer.url()}`)

    // Expose the base URL to the renderer via IPC so use-contributes
    // can build http:// URLs without knowing the port at compile time.
    registerExtHttpChannel(() => extHttpServer.url())

    // Absolute path to the webview bridge preload bundle (built as a second
    // preload entry — see electron.vite.config.ts).
    const webviewBridgePath = path.join(__dirname, "../preload/webview-bridge.js")


    // Track current language and theme so webviews can request initial state.
    //
    // Both are RESOLVED values pushed from the renderer — only the renderer
    // can resolve "auto" against `prefers-color-scheme` (theme) and
    // `navigator.language` (language). Main is just a broker: it caches
    // whatever the renderer pushed last and rebroadcasts to every webview
    // on change. Storing the preference here would be wrong because the
    // stored preference can be "auto" (the default).
    let currentLanguage: "en" | "zh-CN" = "en"
    let currentTheme: "light" | "dark" = startupWindowTheme

    function broadcastToWebviews(channel: string, payload: unknown) {
      for (const wc of require("electron").webContents.getAllWebContents()) {
        try { wc.send(channel, payload) } catch { /* ignore */ }
      }
    }

    ipcMain.handle("language:set-resolved", (_e, language: unknown) => {
      if (language !== "en" && language !== "zh-CN") return
      if (language === currentLanguage) return
      currentLanguage = language
      broadcastToWebviews("webview:language-changed", currentLanguage)
    })

    ipcMain.handle("theme:set-resolved", (_e, theme: unknown) => {
      if (theme !== "light" && theme !== "dark") return
      if (theme === currentTheme) return
      currentTheme = theme
      startupWindowTheme = theme
      broadcastToWebviews("webview:theme-changed", currentTheme)
    })

    // Absolute path to the extension runner bundle.
    // In production: out/main/../extension-runner/index.js
    // In dev: same path (electron-vite outputs all targets under out/)
    const runnerPath = path.join(__dirname, "../extension-runner/index.js")

    const extensionHost = await bootMainExtensionHost({
      registryPath,
      extensionsRoot,
      runnerPath,
      settingsStore: {
        get: async (key, fallback) => {
          const r = await mainStore.get([key])
          return (r[key] as never) ?? fallback
        },
        set: (key, value) => mainStore.set({ [key]: value }),
      },
      callTool: async () => {
        throw new Error("hermes.callTool not wired yet")
      },
      // Backs host.hermes.getSession for extensions. Goes through the
      // backplane (`/hermes/sessions/{id}` reverse-proxies upstream
      // `/api/sessions/{id}`), with auth already wired by the @amiba/core
      // wrapper. Returns null on 404 / network failure / non-200 so the
      // extension treats "no data" and "unreachable" the same way.
      getSession: async (sessionId: string) => {
        if (!sessionId || typeof sessionId !== "string") return null
        try {
          const r = await getHermesSession(sessionId)
          if ("ok" in r && r.ok) return r.session as unknown
          return null
        } catch {
          return null
        }
      },
      // Bulk session list — backs host.hermes.listSessions. Returns []
      // on failure for the same reason as getSession's null return:
      // extension code stays simple.
      listSessions: async (opts) => {
        try {
          const r = await listHermesSessions(opts ?? {})
          if ("ok" in r && r.ok) return r.sessions as unknown[]
          return []
        } catch {
          return []
        }
      },
      // Backs host.hermes.backplaneFetch — the generic backplane channel
      // for extensions (skills / tools / cron endpoints have no dedicated
      // bridge method). Reuses @amiba/core's backplaneFetch (auth bearer +
      // loopback base URL already wired), then reads the Response to a
      // serializable { ok, status, body } envelope since the raw Response
      // can't cross the utility-process RPC boundary. Network failures
      // collapse to { ok:false, status:0, body:"" } so the extension's
      // client treats "unreachable" and "errored" uniformly.
      backplaneFetch: async (path, init) => {
        try {
          const res = await backplaneFetch(path, init ?? {})
          const body = await res.text()
          return { ok: res.ok, status: res.status, body }
        } catch {
          return { ok: false, status: 0, body: "" }
        }
      },
      getI18n: async (_extensionId, _locale) => ({}),
      getLanguage: () => currentLanguage,
      getTheme: () => currentTheme,
      webviewBridgePath,
    })

    ;(globalThis as { __amibaExtensionHost?: typeof extensionHost }).__amibaExtensionHost = extensionHost

    // Fan chat-engine events out to both sinks: the extension host's
    // broadcaster (host.chat.onEvent subscribers) and the built-in
    // tool-activity recorder behind the Usage page. Wired here (not in
    // registerChatHandlers) because the host has to exist first.
    setChatEventPublisher((event, payload) => {
      extensionHost.publishChatEvent(event, payload)
      recordToolActivityEvent(event, payload)
    })

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
          console.warn("[amiba] dock icon load failed:", err)
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
    registerQuickAskIpcHandlers(summonWindow)
    // Poll the gateway for new cron-run completions and push them to
    // the Heads-up Notifier. The watcher tolerates a not-yet-ready
    // backplane (silent retry every 30s) so it's safe to start while the
    // built-in Runtime services are still initializing.
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

    // External entry points: OS-level `amiba://` URLs and the local
    // Unix socket inbox. Both write `home.pendingPrompt` and summon the
    // window; the renderer's existing watcher routes to chat.
    registerProtocolHandler(summonWindow)
    try {
      inboxServer = await startUnixSocketInbox(summonWindow)
    } catch (err) {
      console.error("[main] failed to start inbox socket:", err)
    }

    // macOS dock-icon click after the user closed the main window. We
    // route through summonWindow so closed → recreate, hidden/minimized
    // → restore, background → focus all work the same as the hotkey.
    // Checking `getAllWindows().length === 0` here would be wrong: the
    // notifier + quick-ask windows are persistent (hidden, not destroyed),
    // so that length is never 0 and the dock click would no-op.
    app.on("activate", () => {
      summonWindow()
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

// Shut down the extension host gracefully before the process exits.
// `before-quit` fires before `will-quit` and before any windows are
// closed; we prevent the default and re-call `app.quit()` after the
// async shutdown so the normal `will-quit` / `window-all-closed` chain
// still runs.
let _extensionHostShutdownDone = false
app.on("before-quit", async (event) => {
  if (_extensionHostShutdownDone) return
  event.preventDefault()
  const host = (globalThis as { __amibaExtensionHost?: { shutdown(): Promise<void> } })
    .__amibaExtensionHost
  if (host) await host.shutdown()
  if (_extHttpServer) await _extHttpServer.stop().catch(() => { /* ignore shutdown errors */ })
  _extensionHostShutdownDone = true
  app.quit()
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
