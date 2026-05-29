/**
 * Screen region capture → temp PNG (+ best-effort OCR text on macOS).
 *
 * Flow:
 *
 *   1. Grab a full screenshot of the display under the cursor via
 *      `desktopCapturer.getSources({ types: ["screen"] })`. We snapshot
 *      first (rather than capturing after selection) so the overlay UI
 *      itself never ends up baked into the resulting image.
 *
 *   2. Stash the snapshot to a temp PNG and load a tiny HTML overlay that
 *      paints it as a static backdrop with a dim veil + a draggable
 *      selection rectangle. The overlay window is a fullscreen frameless
 *      transparent always-on-top BrowserWindow positioned exactly over
 *      the target display.
 *
 *   3. On mouseup the renderer ships the chosen rect back over IPC; main
 *      crops the cached snapshot, writes the result to a second temp PNG
 *      (under `app.getPath("temp")`), and resolves with the path.
 *
 *   4. macOS only: try to extract OCR text from the cropped PNG by
 *      invoking the `shortcuts` CLI against a user-installed shortcut
 *      named "Hermes OCR". This is best-effort — if the shortcut is
 *      missing, errors, or times out we return an empty string and let
 *      callers fall back to image-only.
 *
 * Cancellation: pressing Escape (or releasing without dragging at least
 * a 4x4 region) closes the overlay and resolves with null. Windows is
 * stubbed today — desktopCapturer works there but the overlay alpha
 * behavior and OCR pathway differ enough that we leave that to a
 * follow-up.
 */
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import {
  BrowserWindow,
  app,
  desktopCapturer,
  ipcMain,
  screen,
} from "electron"
import type { IpcMainEvent } from "electron"

const execFileAsync = promisify(execFile)
const IS_MAC = process.platform === "darwin"

export interface ScreenCaptureResult {
  /** Absolute path to the cropped PNG under `app.getPath("temp")`. */
  imagePath: string
  /** OCR-extracted text from the crop. Empty string when unavailable. */
  ocrText: string
}

interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

// Unique channel names so the snip flow can't clash with anything else
// the main process exposes over ipcMain.
const COMPLETE_CHANNEL = "hermes-x:screen-capture:complete"
const CANCEL_CHANNEL = "hermes-x:screen-capture:cancel"

// Minimum draggable region — anything smaller is almost certainly a
// stray click and we treat it as a cancel rather than producing a 1px
// PNG.
const MIN_RECT_PX = 4

// Name of the macOS Shortcut we look up for OCR. Users (and our
// onboarding flow, eventually) install a shortcut by this name that
// takes an image input and returns recognized text.
const OCR_SHORTCUT_NAME = "Hermes OCR"

/**
 * Drop an interactive screen-region selector over the display under the
 * cursor, then crop + save the chosen region as a PNG. Resolves with
 * the file path (and any OCR text we managed to extract) on success, or
 * null when the user cancelled / nothing usable could be captured.
 */
export async function startScreenCapture(): Promise<ScreenCaptureResult | null> {
  if (process.platform === "win32") {
    // Windows stub: desktopCapturer + an overlay window technically work
    // here, but the transparent always-on-top behavior and the OCR path
    // differ enough that the first pass shipped Mac-only. Surface as a
    // soft no-op so the hotkey just doesn't do anything until we wire
    // the Windows variant up.
    return null
  }

  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { bounds, scaleFactor } = display

  // Request the screenshot at the display's native pixel resolution so
  // crops land at full fidelity rather than being upscaled from a
  // smaller thumbnail.
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(bounds.width * scaleFactor),
      height: Math.round(bounds.height * scaleFactor),
    },
  })
  const source =
    sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source) return null
  const fullImage = source.thumbnail
  if (fullImage.isEmpty()) return null

  // Persist the snapshot + overlay HTML to disk. We avoid inlining the
  // PNG as a data URL because a 4K retina screenshot can comfortably
  // exceed Electron's data-URL ceiling for `loadURL`.
  const tempDir = app.getPath("temp")
  const stamp = Date.now()
  const fullPngPath = path.join(tempDir, `hermes-x-snip-full-${stamp}.png`)
  const htmlPath = path.join(tempDir, `hermes-x-snip-overlay-${stamp}.html`)
  await fs.writeFile(fullPngPath, fullImage.toPNG())
  await fs.writeFile(
    htmlPath,
    renderOverlayHtml(
      pathToFileUrl(fullPngPath),
      COMPLETE_CHANNEL,
      CANCEL_CHANNEL,
    ),
  )

  const overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      // The overlay HTML is a tiny script we ship ourselves; it uses
      // `require('electron').ipcRenderer` to ship the rect back. Safe to
      // enable nodeIntegration here because we never load third-party
      // content into this window.
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  })

  if (IS_MAC) {
    // `screen-saver` level keeps us above fullscreen windows; the
    // workspaces flag means the overlay covers the active Space even
    // when we were summoned from a different one.
    overlay.setAlwaysOnTop(true, "screen-saver")
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  // Wire the IPC listeners + overlay teardown into one Promise so the
  // common path (mouseup) and the bail paths (Escape, window close)
  // all flow through the same resolve.
  // Typed as the full EventEmitter listener shape (rest `...args: any[]`)
  // so removeListener stays happy under strictFunctionTypes — the
  // electron typings declare ipcMain listeners with that exact rest
  // signature, and narrower local types would not be assignable back.
  let onComplete:
    | ((event: IpcMainEvent, ...args: unknown[]) => void)
    | null = null
  let onCancel: ((event: IpcMainEvent, ...args: unknown[]) => void) | null =
    null

  const detach = () => {
    if (onComplete) ipcMain.removeListener(COMPLETE_CHANNEL, onComplete)
    if (onCancel) ipcMain.removeListener(CANCEL_CHANNEL, onCancel)
    onComplete = null
    onCancel = null
  }

  const cleanupOverlayFiles = async () => {
    await fs.unlink(fullPngPath).catch(() => {})
    await fs.unlink(htmlPath).catch(() => {})
  }

  let rect: SelectionRect | null = null
  try {
    await overlay.loadFile(htmlPath)
    overlay.show()
    overlay.focus()

    rect = await new Promise<SelectionRect | null>((resolve) => {
      onComplete = (_event, ...args) => resolve(normalizeRect(args[0]))
      onCancel = () => resolve(null)
      ipcMain.once(COMPLETE_CHANNEL, onComplete)
      ipcMain.once(CANCEL_CHANNEL, onCancel)
      overlay.once("closed", () => resolve(null))
    })
  } catch (err) {
    console.error("[hermes-x] screen-capture overlay failed:", err)
    rect = null
  } finally {
    detach()
    if (!overlay.isDestroyed()) overlay.close()
    await cleanupOverlayFiles()
  }

  if (!rect) return null
  if (rect.width < MIN_RECT_PX || rect.height < MIN_RECT_PX) return null

  // Translate CSS pixels from the overlay (which is sized in the
  // display's logical bounds) to the native pixels of the captured
  // image. Clamp aggressively — `nativeImage.crop` throws on
  // out-of-range rects.
  const imageSize = fullImage.getSize()
  const cropX = clamp(Math.round(rect.x * scaleFactor), 0, imageSize.width - 1)
  const cropY = clamp(Math.round(rect.y * scaleFactor), 0, imageSize.height - 1)
  const cropW = clamp(
    Math.round(rect.width * scaleFactor),
    1,
    imageSize.width - cropX,
  )
  const cropH = clamp(
    Math.round(rect.height * scaleFactor),
    1,
    imageSize.height - cropY,
  )

  const cropped = fullImage.crop({
    x: cropX,
    y: cropY,
    width: cropW,
    height: cropH,
  })
  if (cropped.isEmpty()) return null

  const imagePath = path.join(tempDir, `hermes-x-snip-${stamp}.png`)
  await fs.writeFile(imagePath, cropped.toPNG())

  const ocrText = IS_MAC ? await runOcrShortcut(imagePath) : ""

  return { imagePath, ocrText }
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return Math.max(lo, Math.min(n, hi))
}

function normalizeRect(r: unknown): SelectionRect | null {
  if (!r || typeof r !== "object") return null
  const obj = r as Partial<Record<keyof SelectionRect, unknown>>
  const x = Number(obj.x)
  const y = Number(obj.y)
  const width = Number(obj.width)
  const height = Number(obj.height)
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null
  }
  return { x, y, width, height }
}

function pathToFileUrl(p: string): string {
  // Hand-rolled rather than `url.pathToFileURL(...).href` so we can keep
  // the renderer-facing string short and predictable when embedded into
  // an HTML attribute.
  const normalized = p.split(path.sep).join("/")
  const prefix = normalized.startsWith("/") ? "file://" : "file:///"
  return `${prefix}${encodeURI(normalized)}`
}

/**
 * The HTML/CSS/JS payload that drives the drag-to-select UI. Kept
 * inline so the module is self-contained — no extra resource files to
 * keep in sync with the electron-vite copy rules.
 */
function renderOverlayHtml(
  backdropUrl: string,
  completeChannel: string,
  cancelChannel: string,
): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; height: 100vh; width: 100vw; overflow: hidden; }
  body {
    cursor: crosshair;
    user-select: none;
    -webkit-user-select: none;
    background-color: #000;
    background-image: url("${backdropUrl}");
    background-repeat: no-repeat;
    background-position: top left;
    background-size: 100vw 100vh;
  }
  #veil {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  #rect {
    position: fixed;
    border: 1.5px solid #4ea1ff;
    background: rgba(78, 161, 255, 0.06);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    display: none;
  }
  #hint {
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    background: rgba(11, 11, 11, 0.78); color: #f5f5f5;
    padding: 6px 12px; border-radius: 999px;
    font: 12px -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    pointer-events: none;
  }
</style>
</head>
<body>
<div id="veil"></div>
<div id="rect"></div>
<div id="hint">Drag to select · Esc to cancel</div>
<script>
  const { ipcRenderer } = require('electron');
  const rect = document.getElementById('rect');
  const veil = document.getElementById('veil');
  let startX = 0, startY = 0;
  let dragging = false;
  let cur = null;
  let settled = false;

  function setRect(x, y, w, h) {
    rect.style.left = x + 'px';
    rect.style.top = y + 'px';
    rect.style.width = w + 'px';
    rect.style.height = h + 'px';
    rect.style.display = 'block';
  }

  function send(channel, payload) {
    if (settled) return;
    settled = true;
    ipcRenderer.send(channel, payload);
  }

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    cur = { x: startX, y: startY, width: 0, height: 0 };
    veil.style.display = 'none';
    setRect(startX, startY, 0, 0);
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    cur = { x: x, y: y, width: w, height: h };
    setRect(x, y, w, h);
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (!cur || cur.width < ${MIN_RECT_PX} || cur.height < ${MIN_RECT_PX}) {
      send('${cancelChannel}');
      return;
    }
    send('${completeChannel}', cur);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      send('${cancelChannel}');
    }
  });

  window.addEventListener('blur', () => {
    // If the overlay loses focus without producing a selection (user
    // ⌘-tabbed away mid-drag, system alert stole focus, etc.) treat it
    // as a cancel rather than leaving the renderer waiting forever.
    if (!dragging) send('${cancelChannel}');
  });
</script>
</body>
</html>`
}

/**
 * Best-effort macOS OCR via the `shortcuts` CLI. We invoke a
 * user-installed shortcut named "Hermes OCR" with the cropped PNG as
 * input and capture whatever text it prints to stdout. Any failure
 * (shortcut not installed, timeout, non-zero exit) collapses to an
 * empty string so the caller can carry on with image-only.
 */
async function runOcrShortcut(imagePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "shortcuts",
      [
        "run",
        OCR_SHORTCUT_NAME,
        "--input-path",
        imagePath,
        "--output-path",
        "-",
      ],
      {
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
      },
    )
    return stdout.trim()
  } catch {
    return ""
  }
}
