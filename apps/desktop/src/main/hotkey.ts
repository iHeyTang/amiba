import path from "node:path"
import { globalShortcut, systemPreferences } from "electron"

import { deliverPrompt } from "./external-inbox"
import { startScreenCapture } from "./screen-capture"
import { mainStore, type StorageChangeMap } from "./storage"

const IS_MAC = process.platform === "darwin"

/**
 * Configurable summon-the-window hotkey.
 *
 * The renderer writes this into the shared store under `STORE_KEY`; the
 * main process owns the actual binding. Three modes:
 *
 *   - `disabled`     — no global hotkey at all.
 *   - `doubleTap`    — tap the same modifier key twice within
 *                      `DOUBLE_TAP_MAX_MS`. Requires `uiohook-napi`'s
 *                      low-level keyboard hook because Electron's
 *                      `globalShortcut` only accepts full chord
 *                      accelerators, not modifier-only patterns. On
 *                      macOS the user must grant Accessibility access in
 *                      System Settings → Privacy & Security so the hook
 *                      receives events.
 *   - `accelerator`  — standard Electron accelerator string (e.g.
 *                      `"CommandOrControl+Shift+H"`). Cheap to register;
 *                      no native module required.
 *
 * Default is double-tap Meta — that maps to ⌘ on macOS, ⊞ on Windows,
 * Super on Linux — matching the user's "默认是双击command" intent on
 * mac while still offering a sensible analogue elsewhere.
 */
export type SummonHotkey =
  | { kind: "disabled" }
  | { kind: "doubleTap"; modifier: SummonModifier }
  | { kind: "accelerator"; accelerator: string }

export type SummonModifier = "Meta" | "Control" | "Alt" | "Shift"

export const SUMMON_HOTKEY_STORE_KEY = "settings.desktop.summonHotkey"
export const DEFAULT_SUMMON_HOTKEY: SummonHotkey = {
  kind: "doubleTap",
  modifier: "Meta",
}

const DOUBLE_TAP_MAX_MS = 400

/**
 * Snip-region accelerator. Fixed for now (the summon hotkey carries
 * all the customizability budget) and identical across platforms.
 *
 * NOTE on the key literal: Electron 33's accelerator parser rejects
 * `"Period"` as a key name on macOS with a conversion-failure throw
 * (the registration call fails with `Error processing argument at
 * index 0`). The literal `"."` character is the documented
 * cross-version-stable form and parses cleanly on every supported
 * platform. We keep the chord identical to what `Period` would mean
 * (⌘⇧.) — only the spelling changed.
 *
 * On non-mac platforms the shortcut still registers, but
 * `startScreenCapture` is a no-op there for now (Windows stub) so the
 * binding is effectively dormant.
 */
const SNIP_ACCELERATOR = "CommandOrControl+Shift+."

let summonCallback: () => void = () => {}
let snipSummonCallback: () => void = () => {}
let currentHotkey: SummonHotkey | null = null
let snipRegistered = false

// uiohook-napi is lazily required so a packaging failure (missing
// prebuilt for the user's platform, denied Accessibility permission,
// etc.) degrades to "no double-tap" instead of crashing the whole main
// process. The first reference triggers the require; we cache the
// result + a startup-success flag.
type UiohookKeyMap = Record<string, number>
interface UiohookHandle {
  on(event: "keydown" | "keyup", cb: (e: { keycode: number }) => void): void
  removeAllListeners(event: "keydown" | "keyup"): void
  start(): void
  stop(): void
}
interface UiohookModule {
  uIOhook: UiohookHandle
  UiohookKey: UiohookKeyMap
}
let uiohookModule: UiohookModule | null | undefined
function loadUiohook(): UiohookModule | null {
  if (uiohookModule !== undefined) return uiohookModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    uiohookModule = require("uiohook-napi") as UiohookModule
  } catch (err) {
    console.warn(
      "[amiba] uiohook-napi unavailable — double-tap hotkey disabled. " +
        "Falling back to accelerator-only mode.",
      err,
    )
    uiohookModule = null
  }
  return uiohookModule
}

let uiohookStarted = false
let doubleTapListenersAttached = false

// Double-tap state machine.
let lastTapMs = 0
let candidateDownMs = 0
let candidateValid = false

function modifierKeycodes(mod: UiohookKeyMap, modifier: SummonModifier): number[] {
  // Most uiohook key constants have plain + Left/Right variants; collect
  // whichever the running build exposes so single-side keyboards still
  // trigger. Missing entries are silently dropped — the resulting set is
  // empty only if uiohook is wired up but the modifier name is wrong,
  // which is a programmer error caught by the type system above.
  const names = [modifier, `${modifier}Left`, `${modifier}Right`]
  const codes: number[] = []
  for (const name of names) {
    const code = mod[name]
    if (typeof code === "number") codes.push(code)
  }
  return codes
}

function attachDoubleTap(modifier: SummonModifier): boolean {
  // macOS gates global keyboard hooks behind "Accessibility" in System
  // Settings → Privacy & Security. Without that grant, uiohook only
  // sees events delivered to the currently focused app — which in dev
  // mode means events while the IDE that spawned Electron has focus,
  // not anywhere else. Calling `isTrustedAccessibilityClient(true)`
  // returns the current trust state AND, on first call per binary,
  // pops the system dialog inviting the user to add the running app to
  // the trusted list. Trust takes effect on the next process launch —
  // we log a clear hint so the user knows to restart Amiba after
  // granting (or to grant their IDE in dev mode).
  if (IS_MAC) {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true)
    if (!trusted) {
      console.warn(
        "[amiba] Accessibility access not granted yet. macOS will only " +
          "deliver global key events to Amiba after you allow it in " +
          "System Settings → Privacy & Security → Accessibility and " +
          "restart the app. (In `pnpm dev`, the binary asking for the " +
          "permission is the IDE that spawned Electron — grant it there " +
          "or run a packaged build.)",
      )
    }
  }

  const uio = loadUiohook()
  if (!uio) return false
  const codes = new Set(modifierKeycodes(uio.UiohookKey, modifier))
  if (codes.size === 0) {
    console.warn(
      `[amiba] uiohook-napi has no keycode for modifier '${modifier}'.`,
    )
    return false
  }

  // Reset state every time we attach so a stale candidate from a previous
  // binding doesn't leak through.
  lastTapMs = 0
  candidateDownMs = 0
  candidateValid = false

  uio.uIOhook.on("keydown", (e) => {
    if (codes.has(e.keycode)) {
      // Pressing the tracked modifier — start a tap candidate.
      candidateDownMs = Date.now()
      candidateValid = true
    } else if (candidateValid) {
      // Any other key while the modifier is down means the user is
      // composing a real chord (⌘+C, ⌘+Tab, …). Cancel the candidate so
      // the chord doesn't count as a tap.
      candidateValid = false
    }
  })

  uio.uIOhook.on("keyup", (e) => {
    if (!codes.has(e.keycode)) return
    const now = Date.now()
    if (!candidateValid || candidateDownMs === 0) {
      candidateDownMs = 0
      return
    }
    candidateDownMs = 0
    candidateValid = false
    // Two valid solo taps within the window → fire.
    if (now - lastTapMs <= DOUBLE_TAP_MAX_MS) {
      lastTapMs = 0
      try {
        summonCallback()
      } catch (err) {
        console.error("[amiba] summon callback threw:", err)
      }
      return
    }
    lastTapMs = now
  })

  if (!uiohookStarted) {
    try {
      uio.uIOhook.start()
      uiohookStarted = true
    } catch (err) {
      console.error("[amiba] uiohook start() failed:", err)
      return false
    }
  }
  doubleTapListenersAttached = true
  return true
}

function detachDoubleTap() {
  if (!doubleTapListenersAttached) return
  const uio = loadUiohook()
  if (!uio) return
  uio.uIOhook.removeAllListeners("keydown")
  uio.uIOhook.removeAllListeners("keyup")
  doubleTapListenersAttached = false
}

function applyHotkey(next: SummonHotkey) {
  // Always tear down the previous binding so flipping modes never leaves
  // a stale accelerator or hook around. We unregister the specific
  // summon accelerator (rather than `unregisterAll`) so the separately
  // managed snip shortcut survives a summon-hotkey config change.
  if (currentHotkey?.kind === "accelerator") {
    globalShortcut.unregister(currentHotkey.accelerator)
  }
  if (currentHotkey?.kind === "doubleTap") {
    detachDoubleTap()
  }
  currentHotkey = next

  if (next.kind === "disabled") return

  if (next.kind === "accelerator") {
    // Electron 33 throws (rather than returning false) when the
    // accelerator string can't be parsed. Wrap so an invalid
    // user-configured chord never wedges the whole hotkey manager.
    let ok = false
    try {
      ok = globalShortcut.register(next.accelerator, summonCallback)
    } catch (err) {
      console.warn(
        `[amiba] Accelerator '${next.accelerator}' rejected by Electron:`,
        (err as Error)?.message,
      )
    }
    if (!ok) {
      console.warn(
        `[amiba] Failed to register accelerator '${next.accelerator}'. ` +
          "It's likely already claimed by another app or the OS.",
      )
    }
    return
  }

  // double-tap
  const ok = attachDoubleTap(next.modifier)
  if (!ok) {
    console.warn(
      "[amiba] Double-tap mode unavailable; the hotkey is effectively off. " +
        "Pick an accelerator binding from Preferences as a fallback.",
    )
  }
}

/**
 * Fire the snip flow: drop the region selector, then promote the
 * captured PNG into the chat composer as a real image attachment (via
 * the same `pendingPrompt` channel HomeView already watches). We do NOT
 * extract text from the image locally — the agent's vision tool reads
 * the PNG on demand using a multimodal model, which is both more
 * accurate than any on-device OCR and needs zero setup. The composer
 * stays empty so the user can type their actual question.
 *
 * In-flight guard: a stray double-press of ⌘⇧. while the selector
 * overlay is up would otherwise spawn a second full-screen overlay on
 * top of the first; we short-circuit until the prior snip resolves.
 */
let snipInFlight = false

function handleSnipHotkey(): void {
  if (snipInFlight) return
  snipInFlight = true
  void (async () => {
    try {
      const result = await startScreenCapture()
      if (!result) return
      const name = path.basename(result.imagePath)
      await deliverPrompt(
        {
          attachments: [
            {
              uiId: `snip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name,
              mime: "image/png",
              size: result.sizeBytes,
              kind: "image",
              path: result.imagePath,
              thumbDataUrl: result.thumbDataUrl || undefined,
            },
          ],
          sourceApp: "Screen Snip",
        },
        snipSummonCallback,
      )
    } catch (err) {
      console.error("[amiba] snip hotkey failed:", err)
    } finally {
      snipInFlight = false
    }
  })()
}

function registerSnip(): void {
  if (snipRegistered) return
  // Same try/catch wrap as the configurable summon accelerator above —
  // Electron 33 throws on rejected key names instead of returning
  // false, and an unhandled throw here used to leave the app booting
  // with no IPC handlers attached.
  let ok = false
  try {
    ok = globalShortcut.register(SNIP_ACCELERATOR, handleSnipHotkey)
  } catch (err) {
    console.warn(
      `[amiba] Snip accelerator '${SNIP_ACCELERATOR}' rejected by Electron:`,
      (err as Error)?.message,
    )
  }
  if (!ok) {
    console.warn(
      `[amiba] Failed to register snip accelerator '${SNIP_ACCELERATOR}'. ` +
        "It's likely already claimed by another app or the OS.",
    )
    return
  }
  snipRegistered = true
}

function unregisterSnip(): void {
  if (!snipRegistered) return
  try {
    globalShortcut.unregister(SNIP_ACCELERATOR)
  } catch (err) {
    console.warn("[amiba] unregister snip failed:", err)
  }
  snipRegistered = false
}

function readStoredHotkey(value: unknown): SummonHotkey {
  // Accept anything that round-trips through the discriminated union.
  // Anything else (corrupt store, schema drift) falls back to the
  // default so the app remains usable.
  if (typeof value !== "object" || value === null) return DEFAULT_SUMMON_HOTKEY
  const v = value as { kind?: string } & Record<string, unknown>
  if (v.kind === "disabled") return { kind: "disabled" }
  if (v.kind === "doubleTap" && typeof v.modifier === "string") {
    const mods: SummonModifier[] = ["Meta", "Control", "Alt", "Shift"]
    if (mods.includes(v.modifier as SummonModifier)) {
      return { kind: "doubleTap", modifier: v.modifier as SummonModifier }
    }
  }
  if (v.kind === "accelerator" && typeof v.accelerator === "string") {
    return { kind: "accelerator", accelerator: v.accelerator }
  }
  return DEFAULT_SUMMON_HOTKEY
}

/**
 * Load the persisted hotkey config, apply it, and subscribe to renderer
 * writes so changes from the Preferences UI take effect immediately
 * without a restart.
 *
 * `onSummon` runs for the user-configurable summon hotkey (which may
 * pre-fill the composer with the current text selection).
 * `onSnipSummon` runs after a screen-region capture has already
 * produced its own pending prompt — typically the plain raise-window
 * path, since we don't want to clobber the prompt by re-running
 * selection capture on top of it.
 */
export async function startHotkeyManager(
  onSummon: () => void,
  onSnipSummon: () => void = onSummon,
) {
  summonCallback = onSummon
  snipSummonCallback = onSnipSummon
  const { [SUMMON_HOTKEY_STORE_KEY]: stored } = await mainStore.get(
    SUMMON_HOTKEY_STORE_KEY,
  )
  applyHotkey(readStoredHotkey(stored))
  registerSnip()

  mainStore.watch((changes: StorageChangeMap) => {
    if (!(SUMMON_HOTKEY_STORE_KEY in changes)) return
    applyHotkey(readStoredHotkey(changes[SUMMON_HOTKEY_STORE_KEY]?.newValue))
  })
}

/** Release native + Electron handles before the process exits. */
export function stopHotkeyManager() {
  if (currentHotkey?.kind === "accelerator") {
    globalShortcut.unregister(currentHotkey.accelerator)
  }
  unregisterSnip()
  detachDoubleTap()
  if (uiohookStarted) {
    const uio = loadUiohook()
    try {
      uio?.uIOhook.stop()
    } catch (err) {
      console.warn("[amiba] uiohook stop() failed:", err)
    }
    uiohookStarted = false
  }
  currentHotkey = null
}
