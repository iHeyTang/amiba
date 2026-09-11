import { fileURLToPath } from "node:url";
import path from "node:path";
import type net from "node:net";
import {
  BrowserWindow,
  Menu,
  app,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
} from "electron";
import { setPlatform } from "@amiba/app-runtime/platform";
import {
  MAC_TRAFFIC_LIGHT_TOP,
  WINDOW_TITLE_BAR_HEIGHT,
} from "../shared/window-chrome";

// Process-level safety nets. Without these, an unhandled rejection inside
// any async path (storage I/O, runtime events, IPC handlers) can leave
// the process in "deprecated future-throw" mode where Node may terminate
// or behave inconsistently across versions. We log + continue so the
// user's main window stays alive while we surface the bug.
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err);
});

import {
  createNotifierWindow,
  destroyNotifierWindow,
  hideNotifier,
  showDemoNotifier,
  showPluginNotification,
} from "./notifier-window";
import { pluginNotificationOperation } from "./plugin-notification";
import { buildAppMenuTemplate } from "./app-menu";
import {
  createQuickAskWindow,
  destroyQuickAskWindow,
  hideQuickAsk,
  resizeQuickAsk,
  setQuickAskIgnoreMouseEvents,
  summonQuickAsk,
} from "./quick-ask-window";
import {
  attachSecondInstanceHandler,
  registerProtocolHandler,
  startUnixSocketInbox,
  stopUnixSocketInbox,
} from "./external-inbox";
import { startHotkeyManager, stopHotkeyManager } from "./hotkey";
import { registerIpcHandlers } from "./ipc";
import { registerEmbeddedPageHandlers } from "./embedded-page";
import { embeddedBrowserController } from "./embedded-browser";
import { createMainPlatformAdapter } from "./platform";
import { cleanupOldSnips } from "./screen-capture";
import { startWorkspaceManager, stopWorkspaceManager } from "./workspace";
import { disposeWorkspaceDevelopment } from "./workspace-development";
import { mainStore } from "./storage";
import { dshRuntime } from "./dsh-runtime";
import {
  startDshNativeGateway,
  type DshNativeGateway,
} from "./dsh-native-gateway";
import { resolveUserDataOverride } from "./user-data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const userDataOverride = resolveUserDataOverride(process.env.AMIBA_USER_DATA_DIR);
if (userDataOverride) app.setPath("userData", userDataOverride);

const isDev = !app.isPackaged;
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;
const IS_MAC = process.platform === "darwin";

/**
 * Resolve the app icon shipped under `apps/desktop/resources/icon.png`.
 * Path is relative to the built `out/main/index.js` in production
 * (`out/main/../resources` resolves to `out/resources`, which doesn't
 * exist by default — electron-builder copies it via `extraResources`),
 * and relative to project root in dev (we resolve from app.getAppPath()
 * which points at `apps/desktop` in dev mode).
 */
function iconPath(): string {
  return path.join(app.getAppPath(), "resources", "icon.png");
}

/**
 * Cross-origin endpoints the renderer needs to fetch + paint into a
 * `<canvas>` (so they need `Access-Control-Allow-Origin: *` AND
 * `tainted-canvas`-safe response headers).
 *
 *   - bing.com / bing.net  — Bing wallpaper feed (`HPImageArchive.aspx`)
 *                            plus the actual image CDN.
 *
 * Electron renderers go through normal CORS, and Bing doesn't ship CORS
 * headers on these endpoints. Main rewrites those response headers so the
 * wallpaper fetch and canvas luminance measurement can operate.
 */
const CORS_BYPASS_URL_PATTERNS = [
  "https://www.bing.com/*",
  "https://*.bing.net/*",
  "https://*.bing.com/*",
  // The exact live DSH authority is checked again in the handler. This
  // wildcard merely lets webRequest observe the OS-assigned loopback port.
  "http://127.0.0.1:*/*",
];

function isManagedDshShellAsset(rawUrl: string): boolean {
  const baseUrl = dshRuntime.current?.baseUrl;
  if (!baseUrl) return false;
  const target = new URL(rawUrl);
  const runtime = new URL(baseUrl);
  return (
    target.origin === runtime.origin &&
    (target.pathname.startsWith("/assets/") ||
      target.pathname.startsWith("/plugins/"))
  );
}

function installCorsBypass() {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: CORS_BYPASS_URL_PATTERNS },
    (details, callback) => {
      const isBing = details.url.startsWith("https://");
      if (!isBing && !isManagedDshShellAsset(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      const headers = { ...(details.responseHeaders ?? {}) };
      // Strip whatever upstream sent so our injected header wins.
      for (const k of Object.keys(headers)) {
        const norm = k.toLowerCase();
        if (
          norm === "access-control-allow-origin" ||
          norm === "access-control-allow-credentials"
        ) {
          delete headers[k];
        }
      }
      headers["Access-Control-Allow-Origin"] = ["*"];
      if (!isBing) {
        headers["Cross-Origin-Resource-Policy"] = ["cross-origin"];
      }
      callback({ responseHeaders: headers });
    },
  );
}

/**
 * The DSH browser client opens its event streams with the page Origin. The
 * production renderer is file://, which DSH correctly rejects as an opaque
 * web origin. Electron is the trusted local platform boundary, so rewrite
 * Origin only for the exact, currently managed DSH WebSocket authority.
 */
function installDshClientWebSocketHeaders(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["ws://127.0.0.1:*/*"] },
    (details, callback) => {
      const baseUrl = dshRuntime.current?.baseUrl;
      if (!baseUrl) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
      const requestUrl = new URL(details.url);
      const runtimeUrl = new URL(baseUrl);
      if (requestUrl.host !== runtimeUrl.host) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
      const headers = { ...details.requestHeaders };
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === "origin") delete headers[name];
      }
      headers.Origin = runtimeUrl.origin;
      callback({ requestHeaders: headers });
    },
  );
}

/**
 * Permit clipboard writes for the chat bubble's copy-code action. Other
 * privileged requests, including media capture, remain denied. Voice input
 * belonged to the removed compatibility runtime; a future DSH provider plugin
 * must declare and own that capability explicitly.
 */
function installPermissionRequestHandler(): void {
  const allowed = new Set(["clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(allowed.has(permission));
    },
  );
  // Some Chromium APIs (clipboard.writeText among them) gate on the
  // synchronous check handler rather than the async request handler.
  // Mirror the same allowlist here so writeText doesn't get denied
  // before the request handler is ever consulted.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    allowed.has(permission),
  );

  // Arbitrary pages loaded in the built-in browser use a separate persistent
  // session for cookies/login state. They do not inherit Amiba renderer
  // privileges: sites may render normally, but camera, microphone,
  // notifications, MIDI, and other privileged requests are denied.
  const browserSession = session.fromPartition("persist:amiba-browser");
  browserSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  browserSession.setPermissionCheckHandler(() => false);
}

// Track the main window explicitly. The notifier + quick-ask windows
// are persistent (hidden on dismiss, not destroyed), so any "find the
// main window" lookup via BrowserWindow.getAllWindows() would happily
// return one of them after the user closed the real main window via
// the red traffic light — breaking dock-icon reopen, hotkey summon,
// and protocol-URL handling.
let mainWindow: BrowserWindow | null = null;
let startupWindowTheme: "light" | "dark" = nativeTheme.shouldUseDarkColors
  ? "dark"
  : "light";

let _dshNativeGateway: DshNativeGateway | null = null;

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
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  if (!mainWindow.isFocused()) mainWindow.focus();
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
  summonQuickAsk({});
}

/**
 * Raise the primary window and open its settings dialog. Target of the
 * application menu's `Settings…` (⌘, / Ctrl+,). The chord is app-wide, so
 * it also fires while the Quick-Ask popup or the notifier has focus — the
 * dialog lives only in the main window, hence the summon first.
 */
function openSettingsInMainWindow(summon: () => void): void {
  summon();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send("ui:open-settings");
  };
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

/** Raise the primary window and route its renderer to a persisted session. */
function openSessionInMainWindow(
  rawSessionId: string,
  summon: () => void,
): boolean {
  if (typeof rawSessionId !== "string" || !rawSessionId.trim()) return false;
  const sessionId = rawSessionId.trim();
  summon();

  const win = mainWindow;
  if (!win || win.isDestroyed()) return false;
  const send = () => {
    if (!win.isDestroyed()) {
      win.webContents.send("ui:open-session", { sessionId });
    }
  };
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
  return true;
}

/**
 * Wire the renderer-side actions from the Heads-up Notifier back to main:
 *
 *   - `notifier:open-session` — the explicit View action raises the primary
 *     window and asks its renderer to open the matching conversation.
 *   - `notifier:approve` / `notifier:deny` — forward the verdict to the
 *     chat engine so the DSH pending approval resolves.
 */
function registerNotifierIpcHandlers(summon: () => void): void {
  ipcMain.handle("notifier:open-session", (_event, sessionId: string) => {
    if (!openSessionInMainWindow(sessionId, summon)) return;
    hideNotifier();
  });
  ipcMain.handle("notifier:hide", () =>
    hideNotifier({ restorePreviousApp: true }),
  );
  // Manual demo trigger so users can confirm the notifier window
  // appears + clicks register without having to provoke a real
  // approval or wait for a cron run. Exposed via the preload bridge as
  // `window.amiba.notifier.demo(kind?)`.
  ipcMain.handle(
    "notifier:demo",
    (_e, kind?: "chat-completed" | "approval-pending" | "plugin") => {
      showDemoNotifier(kind ?? "chat-completed");
    },
  );
  ipcMain.handle("notifier:approve", (_e, approvalId: string) => {
    void approvalId;
    hideNotifier({ restorePreviousApp: true });
  });
  ipcMain.handle("notifier:deny", (_e, approvalId: string) => {
    void approvalId;
    hideNotifier({ restorePreviousApp: true });
  });
}

/**
 * Quick-Ask Spotlight popup back-channels: dismiss + dynamic resize.
 * The popup streams directly from DSH like the main surface, so Electron
 * exposes only window-level operations here.
 */
function registerQuickAskIpcHandlers(summon: () => void): void {
  ipcMain.handle("quick-ask:dismiss", () => {
    hideQuickAsk();
  });
  ipcMain.handle("quick-ask:open-in-main", (_e, sessionId: string) => {
    if (!openSessionInMainWindow(sessionId, summon)) return;
    hideQuickAsk();
  });
  ipcMain.handle("quick-ask:set-ignore-mouse", (_e, ignore: boolean) => {
    setQuickAskIgnoreMouseEvents(ignore === true);
  });
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
        resizeQuickAsk(contentHeightPx, anchor === "bottom" ? "bottom" : "top");
      }
    },
  );
}

/**
 * Surface renderer failures in the terminal.
 *
 * A renderer that dies takes the whole window to blank white with no other
 * signal: main logs nothing, and the user has to know to reach for DevTools to
 * find out anything at all. These handlers make the failure self-reporting.
 */
function installRendererDiagnostics(win: BrowserWindow): void {
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      `[main] renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[main] preload failed (${preloadPath}):`, error);
  });
  win.on("unresponsive", () => {
    console.error("[main] renderer is unresponsive");
  });
  // Renderer console errors never reach this terminal otherwise. Dev only:
  // a packaged build should not narrate page logs to stdout.
  if (!isDev) return;
  win.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      if (level < 3) return; // 3 = error
      console.error(`[renderer] ${message} (${sourceId}:${line})`);
    },
  );
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
        };
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
    // 40px title-bar row with the native traffic-light frame pinned at y=12.
    // AppKit paints the visible dots one pixel below that frame, so this
    // optical correction aligns them with the web title-bar content.
    // Both values come from the shared window-chrome geometry module.
    autoHideMenuBar: process.platform === "win32",
    titleBarStyle: "hidden",
    trafficLightPosition: IS_MAC
      ? { x: 20, y: MAC_TRAFFIC_LIGHT_TOP }
      : undefined,
    titleBarOverlay: IS_MAC
      ? false
      : {
          color: startupPalette.background,
          symbolColor: startupPalette.titleBarSymbol,
          height: WINDOW_TITLE_BAR_HEIGHT,
        },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Required only for Amiba's visible browser pane. DSH Client plugins
      // render through the official slot runtime; they never receive an
      // Electron <webview> or preload bridge.
      webviewTag: true,
    },
  });

  mainWindow = win;
  installRendererDiagnostics(win);
  // Only this renderer mounts the workbench, so it is the only valid target
  // for the Agent's create-tab request.
  embeddedBrowserController.setHostWindowResolver(() => mainWindow);
  win.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      if (params.partition !== "persist:amiba-browser") {
        event.preventDefault();
        return;
      }
      // The page is untrusted web content. Enforce these preferences in main
      // even if renderer attributes are accidentally changed later.
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      delete webPreferences.preload;
    },
  );
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const internalDev = Boolean(
      RENDERER_DEV_URL && url.startsWith(RENDERER_DEV_URL),
    );
    const internalFile = url.startsWith("file:");
    if (internalDev || internalFile) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1120,
          height: 760,
          minWidth: 820,
          minHeight: 620,
          title: "Amiba",
          backgroundColor: startupPalette.background,
          titleBarStyle: IS_MAC ? "hidden" : "default",
          autoHideMenuBar: process.platform === "win32",
          webPreferences: {
            preload: path.join(__dirname, "../preload/index.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webviewTag: true,
          },
        },
      };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && RENDERER_DEV_URL) {
    const rendererUrl = new URL(RENDERER_DEV_URL);
    rendererUrl.searchParams.set("startupTheme", startupWindowTheme);
    win.loadURL(rendererUrl.toString());
    // DevTools auto-open is opt-in via env so it stays out of the
    // user's face by default. Set `AMIBA_DEVTOOLS=1` in the env to
    // reopen them automatically; otherwise pop them with
    // ⌘⌥I / Ctrl+Shift+I when you actually need them.
    if (process.env.AMIBA_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"), {
      query: { startupTheme: startupWindowTheme },
    });
  }
}

// Single-instance lock. Without this, win/linux protocol launches
// (`amiba://...` from the OS) spawn a fresh Electron process every
// time — the second copy has no hotkey, no chat engine, no shared
// store. With the lock held, every retry funnels through the
// `second-instance` event on the original process, which is exactly
// where we want the URL to land.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Another Amiba instance already owns this user's session — its
  // `second-instance` handler will pick up our argv (including any
  // amiba:// URL) and surface the prompt over there. Bail.
  app.quit();
} else {
  attachSecondInstanceHandler(summonWindow);

  let inboxServer: net.Server | null = null;

  app.whenReady().then(async () => {
    // Install the main-process PlatformAdapter before shared handlers resolve
    // platform services.
    setPlatform(createMainPlatformAdapter());
    // Resolve the user's stored preference before the first BrowserWindow is
    // created so Electron's native canvas and the HTML critical shell paint
    // the same palette. "auto" follows the OS at launch.
    try {
      const storedTheme = (await mainStore.get("settings.ui.theme"))[
        "settings.ui.theme"
      ];
      startupWindowTheme =
        storedTheme === "light" || storedTheme === "dark"
          ? storedTheme
          : nativeTheme.shouldUseDarkColors
            ? "dark"
            : "light";
    } catch {
      startupWindowTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    }
    // Workspace restore reads `mainStore` which can fail (corrupted
    // amiba-store.json, permission denied, etc). DO NOT let that take
    // the whole app down: a failed restore should still leave the user
    // with a working main window. They can re-bind a workspace by
    // dragging a folder into the chat panel later.
    try {
      await startWorkspaceManager();
    } catch (err) {
      console.error(
        "[main] workspace init failed; continuing without restore:",
        err,
      );
    }
    // Best-effort cleanup of stale snip PNGs from previous runs. Fire-
    // and-forget so a slow disk doesn't delay the window appearing.
    void cleanupOldSnips();
    installCorsBypass();
    installDshClientWebSocketHeaders();
    installPermissionRequestHandler();
    registerIpcHandlers();
    registerEmbeddedPageHandlers();
    // Replace Electron's implicit default menu (which has no Preferences
    // entry) before any window exists so ⌘, / Ctrl+, is live from the first
    // frame. Debugging commands are kept out of the packaged macOS menu.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildAppMenuTemplate({
          platform: process.platform,
          appName: app.name,
          development: isDev,
          onOpenSettings: () => openSettingsInMainWindow(summonWindow),
        }),
      ),
    );
    try {
      _dshNativeGateway = await startDshNativeGateway([
        ...embeddedBrowserController.platformOperations(),
        // DSH plugins post desktop notifications through the runtime's
        // notification hub; the runtime-gateway plugin forwards each one
        // here for the heads-up notifier to render.
        pluginNotificationOperation(showPluginNotification),
      ]);
      process.env.AMIBA_RUNTIME_GATEWAY_URL = _dshNativeGateway.url;
      process.env.AMIBA_RUNTIME_GATEWAY_TOKEN = _dshNativeGateway.token;
      console.info(
        `[main] DSH native gateway: ${_dshNativeGateway.url}`,
      );
    } catch (error) {
      console.error("[main] DSH native gateway failed to start:", error);
    }
    createWindow();
    createNotifierWindow();
    // Pre-create the Quick-Ask popup so the first double-tap doesn't
    // pay BrowserWindow construction + renderer boot latency (~400ms
    // cold). Hidden by default; surfaces via `summonQuickAsk` on
    // hotkey.
    createQuickAskWindow();
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
          const img = nativeImage.createFromPath(iconPath());
          if (!img.isEmpty()) app.dock!.setIcon(img);
        } catch (err) {
          console.warn("[amiba] dock icon load failed:", err);
        }
      };
      pinDockIcon();
      // Belt-and-braces re-pin after the first event loop tick — covers
      // the case where macOS resets the dock icon as part of finishing
      // the panel window's setup (which we observed: setIcon succeeds
      // synchronously but the dock still shows the Electron default).
      setTimeout(pinDockIcon, 200);
      app.on("activate", pinDockIcon);
    }
    registerNotifierIpcHandlers(summonWindow);
    registerQuickAskIpcHandlers(summonWindow);

    // Load the persisted summon-hotkey config and start listening. The
    // manager subscribes to renderer writes too, so changes from the
    // Preferences panel take effect without a restart.
    //
    // Quick-Ask hotkey just opens the popup — no selection capture, no
    // clipboard reads. Users paste their own context with ⌘V. The snip
    // hotkey (⌘⇧.) takes the raw `summonWindow` because by the time we
    // raise the main window the snip flow has already written its own
    // pendingPrompt.
    void startHotkeyManager(summonQuickAskFromHotkey, summonWindow);

    // External entry points: OS-level `amiba://` URLs and the local
    // Unix socket inbox. Both write `home.pendingPrompt` and summon the
    // window; the renderer's existing watcher routes to chat.
    registerProtocolHandler(summonWindow);
    try {
      inboxServer = await startUnixSocketInbox(summonWindow);
    } catch (err) {
      console.error("[main] failed to start inbox socket:", err);
    }

    // macOS dock-icon click after the user closed the main window. We
    // route through summonWindow so closed → recreate, hidden/minimized
    // → restore, background → focus all work the same as the hotkey.
    // Checking `getAllWindows().length === 0` here would be wrong: the
    // notifier + quick-ask windows are persistent (hidden, not destroyed),
    // so that length is never 0 and the dock click would no-op.
    app.on("activate", () => {
      summonWindow();
    });
  });

  app.on("will-quit", () => {
    void stopUnixSocketInbox(inboxServer);
    inboxServer = null;
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Shut down DSH and its narrow native gateway before the process exits.
// `before-quit` fires before `will-quit` and before any windows are
// closed; we prevent the default and re-call `app.quit()` after the
// async shutdown so the normal `will-quit` / `window-all-closed` chain
// still runs.
let _runtimeShutdownDone = false;
app.on("before-quit", async (event) => {
  if (_runtimeShutdownDone) return;
  event.preventDefault();
  if (_dshNativeGateway) {
    await _dshNativeGateway.stop().catch(() => {
      /* ignore shutdown errors */
    });
    _dshNativeGateway = null;
  }
  await dshRuntime.stop().catch(() => {
    /* ignore runtime shutdown errors */
  });
  delete process.env.AMIBA_RUNTIME_GATEWAY_URL;
  delete process.env.AMIBA_RUNTIME_GATEWAY_TOKEN;
  _runtimeShutdownDone = true;
  app.quit();
});

// Electron docs explicitly require us to release global shortcuts before
// quitting; otherwise they can linger on Windows + Linux after the
// process exits and the next launch can't reclaim them. Same goes for
// the uiohook hook used by double-tap mode.
app.on("will-quit", () => {
  stopHotkeyManager();
  destroyNotifierWindow();
  destroyQuickAskWindow();
  void disposeWorkspaceDevelopment();
  void stopWorkspaceManager();
});
