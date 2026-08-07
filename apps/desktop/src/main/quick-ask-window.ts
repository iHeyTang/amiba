/**
 * Spotlight-style Quick-Ask window.
 *
 * A small, frameless, transparent, always-on-top BrowserWindow that
 * appears under double-tap ⌘. Behaves like macOS Spotlight or Raycast:
 *
 *   - Positioned on the display under the **mouse cursor**, NOT the
 *     primary screen — multi-monitor users get the popup on the screen
 *     they were just using.
 *   - A 640px card inside a small transparent shadow-safe canvas. The
 *     renderer owns the only visible surface; the BrowserWindow itself is
 *     deliberately invisible.
 *   - Focusable so typing works; auto-hides on blur and on Esc.
 *   - Pre-filled with the user's current text selection + source app
 *     when available (captured before summon, sent over IPC).
 *
 * The window is a singleton — repeated double-taps toggle visibility
 * rather than spawning duplicates. Hidden (not destroyed) on dismiss so
 * the second summon is instant.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, screen } from "electron";

import {
  resolveQuickAskResizeBounds,
  resolveQuickAskSummonBounds,
  type QuickAskResizeAnchor,
} from "./quick-ask-geometry";
import {
  QUICK_ASK_COMPACT_HEIGHT,
  QUICK_ASK_PICKER_STAGE_HEIGHT,
} from "../shared/quick-ask-layout";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !process.versions.electron
  ? false
  : process.env.ELECTRON_RENDERER_URL !== undefined;
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;
const IS_MAC = process.platform === "darwin";

/**
 * Ignore-blur grace window after a summon. macOS shuffles focus around
 * for a few frames right after the panel takes key status; without
 * this grace window the popup's `show + focus` would immediately fire
 * blur → hide and we'd see "double-tap ⌘ does nothing". We track the
 * last summon timestamp and silently drop blurs that arrive inside it.
 */
const BLUR_GRACE_MS = 400;
let lastSummonAt = 0;

/** Width of the single visible Quick Ask surface. */
const QUICK_ASK_CARD_WIDTH = 640;
/** Transparent room on every side for the card's CSS shadow to paint into. */
const QUICK_ASK_SHADOW_GUTTER = 16;
const QUICK_ASK_WINDOW_WIDTH =
  QUICK_ASK_CARD_WIDTH + QUICK_ASK_SHADOW_GUTTER * 2;
/** Hard ceiling so a runaway response can't grow the window past 1 screen. */
const QUICK_ASK_MAX_HEIGHT = QUICK_ASK_PICKER_STAGE_HEIGHT;
/** Vertical offset from the top of the active display's work area. */
const QUICK_ASK_TOP_OFFSET_RATIO = 0.22;
/** Keep the fixed picker stage and its modal shadow inside the work area. */
const QUICK_ASK_STAGE_EDGE_MARGIN = 12;

let quickAskWindow: BrowserWindow | null = null;
let quickAskResizeAnchor: QuickAskResizeAnchor = "center";

export interface QuickAskPrefill {
  text?: string;
  sourceApp?: string;
}

/**
 * Compute window position centered on whichever display currently has
 * the mouse cursor. We deliberately use cursor position (not the focused
 * window) because the cursor is the most reliable single-signal "where
 * the user is" indicator across heterogeneous app focus states.
 */
function computeBounds(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const wa = display.workArea;
  const x = wa.x + Math.round((wa.width - QUICK_ASK_WINDOW_WIDTH) / 2);
  const preferredY = wa.y + Math.round(wa.height * QUICK_ASK_TOP_OFFSET_RATIO);
  const pickerStageOverhang = Math.ceil(
    (QUICK_ASK_PICKER_STAGE_HEIGHT - QUICK_ASK_COMPACT_HEIGHT) / 2,
  );
  const minimumY =
    wa.y + pickerStageOverhang + QUICK_ASK_STAGE_EDGE_MARGIN;
  const maximumY =
    wa.y +
    wa.height -
    QUICK_ASK_COMPACT_HEIGHT -
    pickerStageOverhang -
    QUICK_ASK_STAGE_EDGE_MARGIN;
  const y = Math.min(Math.max(preferredY, minimumY), maximumY);
  return {
    x,
    y,
    width: QUICK_ASK_WINDOW_WIDTH,
    height: QUICK_ASK_COMPACT_HEIGHT,
  };
}

/**
 * Create the Quick-Ask popup. Idempotent — subsequent calls return the
 * existing window. Hidden by default; surface with `summonQuickAsk`.
 */
export function createQuickAskWindow(): BrowserWindow {
  if (quickAskWindow && !quickAskWindow.isDestroyed()) return quickAskWindow;

  quickAskResizeAnchor = "center";

  const compactBounds = computeBounds();
  const { x, y, width, height } = resolveQuickAskSummonBounds(
    compactBounds,
    QUICK_ASK_PICKER_STAGE_HEIGHT,
    "center",
  );

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    // Re-enabled now that the NSPanel + skipTransformProcessType +
    // no-app.focus combination has the focus path working without
    // tripping the screen-saver-layer composition bug. Transparent
    // window lets the renderer's rounded card paint with macOS's
    // native window shadow rounding the corners — no black band
    // below the content like with `transparent: false`.
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // The renderer paints the one and only shadow inside the transparent
    // gutter. Native panel shadows are disabled: on transparent frameless
    // windows their bounds vary by macOS release and can be cropped into a
    // hard horizontal band at the BrowserWindow edge.
    hasShadow: false,
    focusable: true,
    show: false,
    backgroundColor: "#00000000",
    // macOS NSPanel — KEY thing that makes this actually work as a
    // Spotlight-style popup. With `type: 'panel'` the window can become
    // the key window WITHOUT making Electron the active app, which
    // matches the Spotlight / Raycast / Alfred UX (you press the hotkey
    // from anywhere and the popup grabs typing focus immediately). The
    // default `type` (a normal NSWindow) on macOS 14+ refuses to take
    // focus when the owning app isn't already frontmost — symptom:
    // `visible=true focused=false` and the user "sees nothing" because
    // macOS composes our transparent window into an offscreen layer.
    ...(IS_MAC ? { type: "panel" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // `type: 'panel'` above implicitly demotes the process to
  // "accessory" (no dock icon, no App Switcher). Flip back to
  // "regular" — we're a full app that ALSO happens to own a
  // Spotlight-style panel; the panel's nonactivating focus is a
  // window-level style mask, not an app-level policy, so the
  // policy here doesn't interfere with it.
  if (IS_MAC) {
    try {
      app.setActivationPolicy("regular");
    } catch (err) {
      console.warn("[amiba] setActivationPolicy failed:", err);
    }
  }

  // DO NOT use `setAlwaysOnTop(true, "screen-saver")` here. That
  // level puts the window on the macOS "screen-saver" compositor
  // layer, which on macOS 14+ (Tahoe) renders correctly only on the
  // PRIMARY display — on a secondary display (especially one with a
  // negative Y origin, i.e. positioned above the primary), the layer
  // ends up offscreen and the user sees nothing even though
  // `visible=true focused=false` says otherwise.
  //
  // NSPanel (`type: 'panel'` in the constructor) is already
  // window-level floating on its own, and the constructor's
  // `alwaysOnTop: true` keeps it above normal app windows. That
  // combination is what Raycast/Alfred ship with.
  //
  // `skipTransformProcessType: true` is the macOS knob that stops
  // Electron from quietly demoting the process to
  // `ProhibitedAccessoryProcess` when we toggle visibility — without
  // it, second-summons land with focused=false because the process
  // can't claim key window status anymore.
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  // Auto-dismiss when the user clicks away. Esc-to-dismiss is handled in
  // the renderer (sends `quick-ask:dismiss` back). The grace window
  // suppresses blurs that arrive in the first few frames after summon,
  // when macOS hasn't finished settling focus from the AppleScript
  // selection-capture pass yet.
  win.on("blur", () => {
    if (Date.now() - lastSummonAt < BLUR_GRACE_MS) return;
    if (!win.isDestroyed() && win.isVisible()) win.hide();
  });

  win.on("closed", () => {
    if (quickAskWindow === win) quickAskWindow = null;
  });

  if (isDev && RENDERER_DEV_URL) {
    void win.loadURL(`${RENDERER_DEV_URL}/quick-ask/index.html`);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/quick-ask/index.html"));
  }

  quickAskWindow = win;
  return win;
}

/**
 * Show (or re-show) the Quick-Ask popup, repositioned to the display
 * currently under the cursor, with optional prefill from a captured
 * text selection.
 *
 * Toggle semantics: if the popup is already visible, hide it. That way
 * a stray second double-tap dismisses rather than refocusing.
 */
export function summonQuickAsk(prefill: QuickAskPrefill = {}): void {
  let win = quickAskWindow;
  if (!win || win.isDestroyed()) {
    win = createQuickAskWindow();
  }

  if (win.isVisible()) {
    // Toggle semantics — second double-tap dismisses rather than
    // re-shows. Most easily diagnosed via console: if you see this
    // log on every double-tap and the popup is invisible, it means
    // a previous blur missed clearing visibility state and we're
    // toggling at the wrong cadence.
    console.log("[amiba] summonQuickAsk: already visible → hide");
    win.hide();
    return;
  }
  console.log("[amiba] summonQuickAsk: showing");
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  console.log(
    "[amiba] cursor=%o display.bounds=%o display.workArea=%o",
    cursor,
    display.bounds,
    display.workArea,
  );

  // Reposition on every summon so multi-monitor users always get the
  // popup on their current display, and so dock / display arrangement
  // changes don't leave us stranded off-screen. The HEIGHT, however,
  // is preserved from the previous session — the renderer is the
  // source of truth on what size the popup should be (it knows whether
  // there's a conversation showing). Preserve the last resize anchor too:
  // an overlay that survived a blur must reopen with the composer at the
  // same compact screen coordinate, not with the tall transparent window's
  // top edge placed at the compact Y position.
  const target = computeBounds();
  const current = win.getBounds();
  const currentHeight = current.height || target.height;
  const next = resolveQuickAskSummonBounds(
    target,
    currentHeight,
    quickAskResizeAnchor,
  );
  console.log(
    "[amiba] setBounds=%o (was=%o, alwaysOnTop=%s, opacity=%s)",
    next,
    current,
    win.isAlwaysOnTop(),
    win.getOpacity(),
  );
  win.setBounds(next);

  const deliver = () => {
    if (win!.isDestroyed()) return;
    lastSummonAt = Date.now();
    // No `app.focus({ steal: true })` — NSPanel windows
    // (`type: 'panel'`) can become key window WITHOUT making Electron
    // the active app. That's literally their reason for existing.
    // Calling `app.focus` would yank the main BrowserWindow forward
    // and the popup would end up behind it (which it did, manifesting
    // as "Quick-Ask shows the main window instead").
    win!.show();
    if (IS_MAC) win!.moveTop();
    win!.focus();
    const b = win!.getBounds();
    console.log(
      "[amiba] after show/focus bounds=%o visible=%s focused=%s minimized=%s",
      b,
      win!.isVisible(),
      win!.isFocused(),
      win!.isMinimized(),
    );
    win!.webContents.send("quick-ask:prefill", {
      text: prefill.text ?? "",
      sourceApp: prefill.sourceApp ?? "",
    });
  };

  const wc = win.webContents;
  if (wc.isLoading()) {
    wc.once("did-finish-load", deliver);
  } else {
    deliver();
  }
}

export function hideQuickAsk(): void {
  const win = quickAskWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
}

export function setQuickAskIgnoreMouseEvents(ignore: boolean): void {
  const win = quickAskWindow;
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(ignore, { forward: true });
}

/**
 * Resize the window to fit the renderer's target content height.
 * Clamped to `QUICK_ASK_MAX_HEIGHT` so a runaway answer never grows
 * past one screen.
 *
 * The fixed picker stage does not resize when a picker toggles. Only the
 * stage↔conversation transition reaches this path; the top-anchored chat
 * expansion may use macOS's built-in animation, while the center-anchored
 * return to the picker stage remains atomic.
 */
export function resizeQuickAsk(
  contentHeightPx: number,
  anchor: QuickAskResizeAnchor = "top",
): void {
  const win = quickAskWindow;
  if (!win || win.isDestroyed()) return;
  const clamped = Math.max(
    QUICK_ASK_PICKER_STAGE_HEIGHT,
    Math.min(Math.round(contentHeightPx), QUICK_ASK_MAX_HEIGHT),
  );
  const bounds = win.getBounds();
  quickAskResizeAnchor = anchor;
  if (bounds.height === clamped) return;
  // Center anchoring makes the compact composer and its modal dialogs share
  // exactly the same screen-space origin.
  const nextBounds = resolveQuickAskResizeBounds(bounds, clamped, anchor);
  // Keep the smoother animation only for the top-anchored conversation
  // transition. AppKit interpolation can make a center anchor appear to drift.
  win.setBounds(nextBounds, IS_MAC && anchor === "top");
}

export function destroyQuickAskWindow(): void {
  const win = quickAskWindow;
  quickAskWindow = null;
  if (!win || win.isDestroyed()) return;
  try {
    win.destroy();
  } catch {
    // best-effort
  }
}

export function getQuickAskWindow(): BrowserWindow | null {
  return quickAskWindow;
}
