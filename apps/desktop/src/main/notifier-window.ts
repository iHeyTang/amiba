import path from "node:path"
import { fileURLToPath } from "node:url"
import { BrowserWindow, screen } from "electron"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !process.versions.electron
  ? false
  : process.env.ELECTRON_RENDERER_URL !== undefined
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL

const NOTIFIER_WIDTH = 360
const NOTIFIER_HEIGHT = 120
/** Margin from screen edges so the card doesn't kiss the dock/taskbar. */
const NOTIFIER_MARGIN = 16

/**
 * Notifier message payloads pushed from main → renderer over the
 * `notifier:message` IPC channel. The renderer dispatches by `type`.
 */
export type NotifierMessage =
  | {
      type: "cron-completed"
      id: string
      title?: string
      summary: string
      timestamp: number
    }
  | {
      type: "approval-pending"
      approvalId: string
      tool?: string
      command?: string
      message: string
      timestamp: number
    }
  | {
      type: "dismiss"
      id: string
    }

let notifierWindow: BrowserWindow | null = null

function computePosition(): { x: number; y: number } {
  const primary = screen.getPrimaryDisplay()
  const wa = primary.workArea
  return {
    x: wa.x + wa.width - NOTIFIER_WIDTH - NOTIFIER_MARGIN,
    y: wa.y + wa.height - NOTIFIER_HEIGHT - NOTIFIER_MARGIN,
  }
}

/**
 * Create the bottom-right Heads-up Notifier window.
 *
 * The window is frameless, always-on-top, transparent, and not focusable
 * — clicks land inside but the window never steals keyboard focus from
 * the user's active app. It's intentionally borderless so the React
 * surface owns all visible chrome (rounded corners, shadow, fade-in).
 */
export function createNotifierWindow(): BrowserWindow {
  if (notifierWindow && !notifierWindow.isDestroyed()) return notifierWindow

  const { x, y } = computePosition()

  const win = new BrowserWindow({
    width: NOTIFIER_WIDTH,
    height: NOTIFIER_HEIGHT,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Pin above OS panels (dock, taskbar) so an active full-screen app
  // doesn't bury the notifier. macOS exposes a screen-saver-level slot
  // which is the highest BrowserWindow can request.
  win.setAlwaysOnTop(true, "screen-saver")
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (isDev && RENDERER_DEV_URL) {
    void win.loadURL(`${RENDERER_DEV_URL}/notifier/index.html`)
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/notifier/index.html"))
  }

  win.on("closed", () => {
    if (notifierWindow === win) notifierWindow = null
  })

  notifierWindow = win
  return win
}

/**
 * Push a payload to the notifier renderer. No-ops if the window is gone
 * — callers don't need to track lifecycle. Auto-shows the window on
 * non-dismiss messages so the renderer can render fresh content
 * immediately.
 */
export function sendToNotifier(msg: NotifierMessage): void {
  const win = notifierWindow
  if (!win || win.isDestroyed()) return
  if (msg.type !== "dismiss" && !win.isVisible()) {
    win.showInactive()
  }
  win.webContents.send("notifier:message", msg)
}

export function showNotifier(): void {
  const win = notifierWindow
  if (!win || win.isDestroyed()) return
  // Reposition on show — the user may have moved the dock or unplugged
  // a display since we created the window.
  const { x, y } = computePosition()
  win.setBounds({ x, y, width: NOTIFIER_WIDTH, height: NOTIFIER_HEIGHT })
  win.showInactive()
}

export function hideNotifier(): void {
  const win = notifierWindow
  if (!win || win.isDestroyed()) return
  win.hide()
}

export function getNotifierWindow(): BrowserWindow | null {
  return notifierWindow
}
