/**
 * Spotlight-style Quick-Ask window.
 *
 * A small, frameless, transparent, always-on-top BrowserWindow that
 * appears under double-tap ⌘. Behaves like macOS Spotlight or Raycast:
 *
 *   - Positioned on the display under the **mouse cursor**, NOT the
 *     primary screen — multi-monitor users get the popup on the screen
 *     they were just using.
 *   - Full work-area transparent stage: the OS window is always sized
 *     to the cursor display's entire work area. The visible card is
 *     positioned purely via CSS — popups never get clipped at the
 *     BrowserWindow edge.
 *   - Focusable so typing works; auto-hides on blur and on Esc.
 *   - Pre-filled with the user's current text selection + source app
 *     when available (captured before summon, sent over IPC).
 *
 * The window is a singleton — repeated double-taps toggle visibility
 * rather than spawning duplicates. Hidden (not destroyed) on dismiss so
 * the second summon is instant.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, screen } from "electron"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !process.versions.electron
  ? false
  : process.env.ELECTRON_RENDERER_URL !== undefined
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL
const IS_MAC = process.platform === "darwin"

/**
 * Ignore-blur grace window after a summon. macOS shuffles focus around
 * for a few frames right after the panel takes key status; without
 * this grace window the popup's `show + focus` would immediately fire
 * blur → hide and we'd see "double-tap ⌘ does nothing". We track the
 * last summon timestamp and silently drop blurs that arrive inside it.
 */
const BLUR_GRACE_MS = 400
let lastSummonAt = 0

/**
 * Presentation mode of the Quick-Ask stage. The OS window is ALWAYS a
 * full-display transparent canvas; the mode only flips event/dismiss
 * policy, never geometry. Only `modal` exists today — `pinned`
 * (click-through stage that stays on blur) and `promoted` (hand the
 * session to a real window) slot into MODE_POLICY + applyMode without a
 * rewrite. See the design spec for how each future mode maps in.
 */
export type QuickAskMode = "modal"

interface ModePolicy {
  /** OS window draggable. Modal stages are fixed, like Spotlight. */
  movable: boolean
  /**
   * Whether blank (transparent) regions pass clicks through to the apps
   * behind. Modal must CAPTURE clicks so the renderer's backdrop can
   * dismiss on outside-click. (`pinned` will flip this to true.)
   */
  ignoreMouseEvents: boolean
  /** Hide the stage when it loses key status (user clicked another app). */
  hideOnBlur: boolean
}

const MODE_POLICY: Record<QuickAskMode, ModePolicy> = {
  modal: { movable: false, ignoreMouseEvents: false, hideOnBlur: true },
}

let currentMode: QuickAskMode = "modal"

/**
 * Apply a presentation mode's window-level policy. Geometry is NOT
 * touched here — the stage is always the full work area (see
 * `computeBounds`). Today only `modal` is wired.
 */
function applyMode(win: BrowserWindow, mode: QuickAskMode): void {
  currentMode = mode
  const policy = MODE_POLICY[mode]
  win.setMovable(policy.movable)
  // `forward: true` is a no-op while ignore=false (modal), but is what a
  // future `pinned` mode needs so mouse-move still reaches the renderer's
  // hover handlers that toggle ignore-state over the card. Pass it
  // unconditionally so the seam is correct for every mode.
  win.setIgnoreMouseEvents(policy.ignoreMouseEvents, { forward: true })
}

let quickAskWindow: BrowserWindow | null = null

export interface QuickAskPrefill {
  text?: string
  sourceApp?: string
}

/**
 * The stage fills the entire work area of whichever display currently
 * holds the mouse cursor. Cursor (not focused window) is the most
 * reliable "where the user is" signal across heterogeneous focus states.
 * A full-work-area transparent canvas is what gives popups room to paint
 * — nothing renders outside a BrowserWindow's pixel rect.
 */
function computeBounds(): {
  x: number
  y: number
  width: number
  height: number
} {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const wa = display.workArea
  return { x: wa.x, y: wa.y, width: wa.width, height: wa.height }
}

/**
 * Create the Quick-Ask popup. Idempotent — subsequent calls return the
 * existing window. Hidden by default; surface with `summonQuickAsk`.
 */
export function createQuickAskWindow(): BrowserWindow {
  if (quickAskWindow && !quickAskWindow.isDestroyed()) return quickAskWindow

  const { x, y, width, height } = computeBounds()

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    // Transparent so the renderer's rounded card shows through without the
    // black band that `transparent: false` paints below the content. The
    // shadow is the card's own CSS now — `hasShadow` is false (a native
    // shadow is a no-op on a transparent window anyway).
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // hasShadow:false — transparent windows don't get a native shadow; the card paints its own CSS shadow.
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
  })

  // `type: 'panel'` above implicitly demotes the process to
  // "accessory" (no dock icon, no App Switcher). Flip back to
  // "regular" — we're a full app that ALSO happens to own a
  // Spotlight-style panel; the panel's nonactivating focus is a
  // window-level style mask, not an app-level policy, so the
  // policy here doesn't interfere with it.
  if (IS_MAC) {
    try {
      app.setActivationPolicy("regular")
    } catch (err) {
      console.warn("[amiba] setActivationPolicy failed:", err)
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
  })

  // Establish the default (and currently only) presentation policy.
  applyMode(win, "modal")

  // Auto-dismiss when the user clicks away. Esc-to-dismiss is handled in
  // the renderer (sends `quick-ask:dismiss` back). The grace window
  // suppresses blurs that arrive in the first few frames after summon,
  // when macOS hasn't finished settling focus from the AppleScript
  // selection-capture pass yet.
  win.on("blur", () => {
    if (Date.now() - lastSummonAt < BLUR_GRACE_MS) return
    if (!MODE_POLICY[currentMode].hideOnBlur) return
    if (!win.isDestroyed() && win.isVisible()) win.hide()
  })

  win.on("closed", () => {
    if (quickAskWindow === win) quickAskWindow = null
  })

  if (isDev && RENDERER_DEV_URL) {
    void win.loadURL(`${RENDERER_DEV_URL}/quick-ask/index.html`)
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/quick-ask/index.html"))
  }

  quickAskWindow = win

  // Warm the window-server realization once, invisibly. The window is
  // created hidden at the STARTUP display's bounds. Without a prior
  // realization, macOS paints the first `orderFront` of a never-shown
  // window at that stale startup frame for one compositor pass before
  // applying the summon's pre-show `setBounds` — producing a visible flash
  // on the startup display when the first summon lands on a DIFFERENT
  // display. One invisible (opacity-0, nonactivating) show/hide cycle now
  // puts the window in the same "already realized" state it has after any
  // later summon — and later summons demonstrably don't flash — so the
  // first real summon is clean. opacity is set to 0 BEFORE showInactive so
  // the warm-up itself never paints a visible frame, then restored.
  win.setOpacity(0)
  win.showInactive()
  win.hide()
  win.setOpacity(1)

  return win
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
  let win = quickAskWindow
  if (!win || win.isDestroyed()) {
    win = createQuickAskWindow()
  }

  if (win.isVisible()) {
    // Toggle semantics — second double-tap dismisses rather than
    // re-shows. Most easily diagnosed via console: if you see this
    // log on every double-tap and the popup is invisible, it means
    // a previous blur missed clearing visibility state and we're
    // toggling at the wrong cadence.
    console.log("[amiba] summonQuickAsk: already visible → hide")
    win.hide()
    return
  }
  console.log("[amiba] summonQuickAsk: showing")
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  console.log(
    "[amiba] cursor=%o display.bounds=%o display.workArea=%o",
    cursor,
    display.bounds,
    display.workArea,
  )

  // The stage always fills the cursor display's work area, so multi-
  // monitor users get it on their current screen and a display-arrangement
  // change can never strand it off-screen. No height preservation: window
  // geometry is constant — the card sizes itself via CSS.
  win.setBounds(computeBounds())

  const deliver = () => {
    if (win!.isDestroyed()) return
    lastSummonAt = Date.now()
    // No `app.focus({ steal: true })` — NSPanel windows
    // (`type: 'panel'`) can become key window WITHOUT making Electron
    // the active app. That's literally their reason for existing.
    // Calling `app.focus` would yank the main BrowserWindow forward
    // and the popup would end up behind it (which it did, manifesting
    // as "Quick-Ask shows the main window instead").
    win!.show()
    if (IS_MAC) win!.moveTop()
    win!.focus()
    const b = win!.getBounds()
    console.log(
      "[amiba] after show/focus bounds=%o visible=%s focused=%s minimized=%s",
      b,
      win!.isVisible(),
      win!.isFocused(),
      win!.isMinimized(),
    )
    win!.webContents.send("quick-ask:prefill", {
      text: prefill.text ?? "",
      sourceApp: prefill.sourceApp ?? "",
    })
  }

  const wc = win.webContents
  if (wc.isLoading()) {
    wc.once("did-finish-load", deliver)
  } else {
    deliver()
  }
}

export function hideQuickAsk(): void {
  const win = quickAskWindow
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) win.hide()
}

export function destroyQuickAskWindow(): void {
  const win = quickAskWindow
  quickAskWindow = null
  if (!win || win.isDestroyed()) return
  try {
    win.destroy()
  } catch {
    // best-effort
  }
}

export function getQuickAskWindow(): BrowserWindow | null {
  return quickAskWindow
}
