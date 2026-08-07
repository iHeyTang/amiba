import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, screen } from "electron";

import type {
  ApprovalPendingNotifierMessage,
  ChatCompletedNotifierMessage,
} from "./chat/completion-notification";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !process.versions.electron
  ? false
  : process.env.ELECTRON_RENDERER_URL !== undefined;
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

/** Visible card dimensions, excluding the transparent shadow-safe canvas. */
const NOTIFIER_CARD_WIDTH = 352;
const NOTIFIER_CARD_HEIGHT = 66;
/** Room for `shadow-overlay` to decay without hitting the BrowserWindow edge. */
const NOTIFIER_SHADOW_GUTTER = 28;
const NOTIFIER_WIDTH = NOTIFIER_CARD_WIDTH + NOTIFIER_SHADOW_GUTTER * 2;
const NOTIFIER_HEIGHT = NOTIFIER_CARD_HEIGHT + NOTIFIER_SHADOW_GUTTER * 2;

/**
 * Notifier message payloads pushed from main → renderer over the
 * `notifier:message` IPC channel. The renderer dispatches by `type`.
 */
export type NotifierMessage =
  | ChatCompletedNotifierMessage
  | ApprovalPendingNotifierMessage
  | {
      type: "cron-completed";
      id: string;
      title?: string;
      summary: string;
      timestamp: number;
    }
  | {
      type: "dismiss";
      id: string;
    };

let notifierWindow: BrowserWindow | null = null;
let notifierOpenedWhileAppInactive = false;

function computePosition(): { x: number; y: number } {
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  return {
    // The transparent canvas reaches the work-area edge; the visible card is
    // still inset by NOTIFIER_SHADOW_GUTTER, preserving the old ~28px margin.
    x: wa.x + wa.width - NOTIFIER_WIDTH,
    y: wa.y + wa.height - NOTIFIER_HEIGHT,
  };
}

/**
 * Create the bottom-right Heads-up Notifier window.
 *
 * The window is frameless, always-on-top, transparent, and shown inactive,
 * so it does not steal keyboard focus when it arrives. It remains focusable
 * after a deliberate click so its controls work reliably across platforms.
 * The React surface owns all visible chrome (rounding, shadow, animation).
 */
export function createNotifierWindow(): BrowserWindow {
  if (notifierWindow && !notifierWindow.isDestroyed()) return notifierWindow;

  const { x, y } = computePosition();

  const win = new BrowserWindow({
    width: NOTIFIER_WIDTH,
    height: NOTIFIER_HEIGHT,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Focusable so the Approve/Deny/Dismiss buttons receive clicks
    // reliably across platforms — Electron's `focusable: false` blocks
    // mouse focus on Linux and is finicky on macOS for buttons inside
    // the window. We still raise the window with `showInactive()` so
    // it doesn't steal focus from the user's frontmost app on arrival;
    // focus only transfers when the user actually clicks.
    focusable: true,
    transparent: true,
    resizable: false,
    // Movable so users can drag the card out of the way when it's
    // covering something. Drag handle is the small strip at the top of
    // the card (CSS `-webkit-app-region: drag`).
    movable: true,
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
  });

  // Pin above OS panels (dock, taskbar) so an active full-screen app
  // doesn't bury the notifier. macOS exposes a screen-saver-level slot
  // which is the highest BrowserWindow can request.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev && RENDERER_DEV_URL) {
    void win.loadURL(`${RENDERER_DEV_URL}/notifier/index.html`);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/notifier/index.html"));
  }

  win.on("closed", () => {
    if (notifierWindow === win) {
      notifierWindow = null;
      notifierOpenedWhileAppInactive = false;
    }
  });

  notifierWindow = win;
  return win;
}

/**
 * Push a payload to the notifier renderer. Auto-recreates the window if
 * a previous instance was destroyed (e.g. user manually closed it via
 * Activity Monitor / Cmd+W), so missing the window is never a permanent
 * dead-end. `dismiss` is the one exception: there's nothing to render so
 * there's no point spawning a brand-new window just to immediately
 * dismiss something that isn't displayed anyway.
 */
export function sendToNotifier(msg: NotifierMessage): void {
  let win = notifierWindow;
  const liveAndUsable = win && !win.isDestroyed();
  if (!liveAndUsable) {
    if (msg.type === "dismiss") return;
    win = createNotifierWindow();
  }
  if (!win || win.isDestroyed()) return;
  if (msg.type !== "dismiss" && !win.isVisible()) {
    notifierOpenedWhileAppInactive =
      BrowserWindow.getFocusedWindow() === null;
    win.showInactive();
  }
  // Deferred until `did-finish-load` if the renderer is still booting,
  // otherwise the first message lands before NotifierView's mount effect
  // attaches its IPC listener and gets dropped on the floor.
  const wc = win.webContents;
  if (wc.isLoading()) {
    wc.once("did-finish-load", () => {
      if (!win!.isDestroyed()) wc.send("notifier:message", msg);
    });
  } else {
    wc.send("notifier:message", msg);
  }
}

export function showNotifier(): void {
  const win = notifierWindow;
  if (!win || win.isDestroyed()) return;
  // Reposition on show — the user may have moved the dock or unplugged
  // a display since we created the window.
  const { x, y } = computePosition();
  win.setBounds({ x, y, width: NOTIFIER_WIDTH, height: NOTIFIER_HEIGHT });
  notifierOpenedWhileAppInactive = BrowserWindow.getFocusedWindow() === null;
  win.showInactive();
}

export function hideNotifier(options?: { restorePreviousApp?: boolean }): void {
  const win = notifierWindow;
  if (!win || win.isDestroyed()) return;
  const restorePreviousApp =
    options?.restorePreviousApp === true &&
    notifierOpenedWhileAppInactive &&
    win.isFocused();
  notifierOpenedWhileAppInactive = false;

  // A click makes the otherwise inactive notifier the key Electron window.
  // Hiding that focused window directly lets macOS promote Amiba's main window,
  // even though the user was working in another app when the card arrived.
  // Hiding the application returns focus to that previous app. The explicit
  // "View" action bypasses this branch and intentionally raises the main window.
  if (process.platform === "darwin" && restorePreviousApp) {
    app.hide();
    return;
  }
  win.hide();
}

export function getNotifierWindow(): BrowserWindow | null {
  return notifierWindow;
}

/**
 * Tear down the notifier window before app quit. macOS does not auto-
 * close non-main windows on `app.quit()`, so without this the floating
 * card can linger as a transparent ghost until the parent process is
 * fully gone. Idempotent.
 */
export function destroyNotifierWindow(): void {
  const win = notifierWindow;
  notifierWindow = null;
  notifierOpenedWhileAppInactive = false;
  if (!win || win.isDestroyed()) return;
  try {
    win.destroy();
  } catch {
    // best-effort
  }
}

/**
 * Fire a fake card so users (and dev) can confirm the notifier pipeline
 * works end-to-end without having to trigger a real approval or wait
 * for a real cron run. `kind` picks between the two card shapes; both
 * dismiss with the buttons (the cron variant's "click to open" raises
 * the main window, but here we just rely on the dismiss action).
 */
export function showDemoNotifier(
  kind:
    | "cron-completed"
    | "chat-completed"
    | "approval-pending" = "cron-completed",
): void {
  const stamp = Date.now();
  if (kind === "chat-completed") {
    sendToNotifier({
      type: "chat-completed",
      id: `demo_${stamp}`,
      sessionId: `demo_${stamp}`,
      title: "Review the release checklist",
      summary: "The checklist is complete and ready for review.",
      timestamp: stamp,
    });
  } else if (kind === "cron-completed") {
    sendToNotifier({
      type: "cron-completed",
      id: `demo_${stamp}`,
      title: "Demo cron job",
      summary:
        "This is a demo notifier card — wired plumbing confirmed. " +
        "Real cards appear when a cron job finishes or the agent " +
        "requests approval.",
      timestamp: stamp,
    });
  } else {
    sendToNotifier({
      type: "approval-pending",
      approvalId: `demo_${stamp}`,
      sessionId: `demo_${stamp}`,
      title: "Review the release checklist",
      tool: "Demo tool",
      command: "rm -rf demo",
      message:
        "This is a demo approval card. Allow/Deny do nothing here — " +
        "real cards POST a decision to the gateway.",
      timestamp: stamp,
    });
  }
}
