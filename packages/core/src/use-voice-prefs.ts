/**
 * `useVoicePrefs` — react to live changes in voice-input preferences.
 *
 * The values live in `getPlatform().storage` under the
 * `VOICE_*_STORAGE_KEY` constants. The hook returns a stable snapshot
 * plus an `update()` helper that fans out to the same store, so the
 * Settings page and the Composer share one source of truth.
 *
 * What lives here vs. config.yaml:
 *   - here (platform.storage): client-side UI prefs (enabled, autoSend,
 *     deviceId). These don't exist outside the desktop renderer.
 *   - config.yaml + .env: provider, model, API keys. The Voice settings
 *     page shows those read-only via /hermes/stt/status and points the
 *     user at the existing CLI flow if they want to change them.
 */

import { useCallback, useEffect, useState } from "react"

import { getPlatform } from "@amiba/platform"

import {
  DEFAULT_VOICE_PREFS,
  VOICE_AUTO_SEND_STORAGE_KEY,
  VOICE_DEVICE_ID_STORAGE_KEY,
  VOICE_ENABLED_STORAGE_KEY,
  type VoicePrefs,
} from "./config"

const ALL_KEYS = [
  VOICE_ENABLED_STORAGE_KEY,
  VOICE_AUTO_SEND_STORAGE_KEY,
  VOICE_DEVICE_ID_STORAGE_KEY,
] as const

function coerce(raw: Record<string, unknown>): VoicePrefs {
  const enabled = raw[VOICE_ENABLED_STORAGE_KEY]
  const autoSend = raw[VOICE_AUTO_SEND_STORAGE_KEY]
  const deviceId = raw[VOICE_DEVICE_ID_STORAGE_KEY]
  return {
    enabled:
      typeof enabled === "boolean" ? enabled : DEFAULT_VOICE_PREFS.enabled,
    autoSend:
      typeof autoSend === "boolean" ? autoSend : DEFAULT_VOICE_PREFS.autoSend,
    deviceId:
      typeof deviceId === "string" ? deviceId : DEFAULT_VOICE_PREFS.deviceId,
  }
}

export interface UseVoicePrefsResult extends VoicePrefs {
  /** True until the first load resolves. */
  loading: boolean
  /** Patch one or more prefs. Persists immediately to platform storage. */
  update: (patch: Partial<VoicePrefs>) => Promise<void>
}

export function useVoicePrefs(): UseVoicePrefsResult {
  const [prefs, setPrefs] = useState<VoicePrefs>(DEFAULT_VOICE_PREFS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const r = await getPlatform().storage.get([...ALL_KEYS])
        if (cancelled) return
        setPrefs(coerce(r as Record<string, unknown>))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    const unsub = getPlatform().storage.watch([...ALL_KEYS], (changes) => {
      setPrefs((prev) => {
        const next = { ...prev }
        for (const key of ALL_KEYS) {
          const change = changes[key]
          if (!change) continue
          const v = change.newValue
          switch (key) {
            case VOICE_ENABLED_STORAGE_KEY:
              if (typeof v === "boolean") next.enabled = v
              else if (v == null) next.enabled = DEFAULT_VOICE_PREFS.enabled
              break
            case VOICE_AUTO_SEND_STORAGE_KEY:
              if (typeof v === "boolean") next.autoSend = v
              else if (v == null) next.autoSend = DEFAULT_VOICE_PREFS.autoSend
              break
            case VOICE_DEVICE_ID_STORAGE_KEY:
              if (typeof v === "string") next.deviceId = v
              else if (v == null) next.deviceId = DEFAULT_VOICE_PREFS.deviceId
              break
          }
        }
        return next
      })
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const update = useCallback(async (patch: Partial<VoicePrefs>) => {
    const out: Record<string, unknown> = {}
    if ("enabled" in patch) out[VOICE_ENABLED_STORAGE_KEY] = patch.enabled
    if ("autoSend" in patch) out[VOICE_AUTO_SEND_STORAGE_KEY] = patch.autoSend
    if ("deviceId" in patch) out[VOICE_DEVICE_ID_STORAGE_KEY] = patch.deviceId
    if (Object.keys(out).length === 0) return
    await getPlatform().storage.set(out)
  }, [])

  return { ...prefs, loading, update }
}
