/**
 * Capture the user's current text selection from whatever app they have
 * focused, so the Quick-Ask Spotlight flow can pre-fill the composer
 * with that text when the global summon hotkey fires.
 *
 * macOS: scripted via AppleScript / osascript. We (a) stash the current
 * clipboard contents, (b) drop a sentinel string so we can tell whether
 * ⌘C actually wrote anything, (c) synthesize ⌘C against the frontmost
 * app, (d) read the (possibly updated) clipboard, (e) restore the
 * original. Both Accessibility access and the standard ⌘C semantics are
 * required — the same Accessibility grant our double-tap hotkey already
 * needs.
 *
 * Windows / Linux: not implemented yet. Windows needs SendInput +
 * OpenClipboard polling, Linux needs xdotool + xclip / a Wayland
 * equivalent. Both return null today so callers fall back to plain
 * summon.
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface CapturedSelection {
  /** The text the user had selected when the hotkey fired. Never empty. */
  text: string
  /** Name of the app the selection came from (e.g. "Safari"), if we could read it. */
  appName: string | null
}

const IS_MAC = process.platform === "darwin"

// Sentinel we drop into the clipboard before synthesizing ⌘C. If it
// comes back unchanged, the frontmost app didn't actually copy anything
// (no selection, app swallowed the chord, missing Accessibility grant,
// etc) — so we know to return null instead of treating whatever was on
// the clipboard before we touched it as "the selection".
const SENTINEL = "__hermes_x_quick_ask_no_selection__"

// 120ms is enough for every app I tested to flush the ⌘C through to the
// pasteboard; less and apps like Chrome occasionally lose the race. The
// whole capture path adds this much latency to every hotkey summon, so
// don't grow it without reason.
const COPY_SETTLE_DELAY_MS = 120

const APPLESCRIPT = `
on run
  set savedClip to ""
  try
    set savedClip to (the clipboard as text)
  end try
  set frontApp to ""
  try
    tell application "System Events"
      set frontApp to name of first application process whose frontmost is true
    end tell
  end try
  set the clipboard to "${SENTINEL}"
  try
    tell application "System Events" to keystroke "c" using {command down}
  end try
  delay ${(COPY_SETTLE_DELAY_MS / 1000).toFixed(3)}
  set copied to ""
  try
    set copied to (the clipboard as text)
  end try
  try
    set the clipboard to savedClip
  end try
  if copied is "${SENTINEL}" then
    return frontApp & linefeed
  end if
  return frontApp & linefeed & copied
end run
`

/**
 * Try to capture the currently selected text plus the frontmost app
 * name. Returns null on non-mac platforms, when nothing was selected,
 * or when scripting failed for any reason — callers should treat null
 * as "fall back to plain summon".
 */
export async function captureSelection(): Promise<CapturedSelection | null> {
  if (!IS_MAC) return null
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", APPLESCRIPT], {
      // Hard upper bound. The script's own `delay` is ~120ms and osascript
      // startup is ~30ms; 2s leaves room for slow apps to finish handling
      // the synthesized ⌘C before we give up.
      timeout: 2000,
      maxBuffer: 4 * 1024 * 1024,
    })
    // Format: `<appName>\n<selection text...>`. The selection itself can
    // contain newlines, so split on the FIRST `\n` only.
    const nl = stdout.indexOf("\n")
    if (nl < 0) return null
    const appName = stdout.slice(0, nl).trim() || null
    // osascript appends its own trailing newline to the final return
    // value; strip exactly one if present, but preserve any newlines the
    // user actually selected.
    const rawText = stdout.slice(nl + 1)
    const text = rawText.endsWith("\n") ? rawText.slice(0, -1) : rawText
    if (!text.trim()) return null
    return { text, appName }
  } catch (err) {
    console.warn("[hermes-x] captureSelection failed:", err)
    return null
  }
}
