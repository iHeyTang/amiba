/**
 * Brain-disconnected composer hint page — port of BrainDisconnectedHint.tsx.
 *
 * Tiny self-contained page rendered in a h-12 WebView above the composer.
 * On mount it probes `health`; if the brain is already connected it renders
 * nothing (the webview is transparent). If disconnected, it renders a pill
 * button that queues an install prompt via IPC.
 *
 * Does NOT depend on @hermes-x/ui — inline styles only to keep the bundle
 * small and avoid SSR/theme-provider bootstrapping overhead.
 */

import { useEffect, useState } from "react"
import { hermes } from "../shared/hermes-bridge"
import enCatalog from "../../i18n/en.json"
import zhCNCatalog from "../../i18n/zh-CN.json"
import { BRAIN_DEFAULT_URL, BRAIN_URL_KEY } from "../../main/lib/constants"
import { buildBrainInstallPrompt } from "../../main/lib/brain-install-ui"

// ---------------------------------------------------------------------------
// Minimal i18n
// ---------------------------------------------------------------------------

function t(key: string): string {
  const lang = hermes.language
  const catalog = lang === "zh-CN"
    ? (zhCNCatalog as Record<string, string>)
    : (enCatalog as Record<string, string>)
  return catalog[key] ?? key
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [show, setShow] = useState(false)
  const [theme, setTheme] = useState<"light" | "dark">(() => hermes.theme)

  useEffect(() => {
    return hermes.on("theme", (v) => setTheme(v as "light" | "dark"))
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const h = await hermes.ipc.invoke<{ status: string } | null>("health")
        if (!cancelled) setShow(!h)
      } catch {
        if (!cancelled) setShow(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!show) return null

  const isDark = theme === "dark"

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        background: "transparent",
      }}
    >
      <button
        type="button"
        style={{
          borderRadius: "9999px",
          padding: "4px 12px",
          fontSize: "12px",
          lineHeight: "1.4",
          cursor: "pointer",
          border: "none",
          background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
          color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = isDark
            ? "rgba(255,255,255,0.12)"
            : "rgba(0,0,0,0.09)"
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = isDark
            ? "rgba(255,255,255,0.08)"
            : "rgba(0,0,0,0.06)"
        }}
        onClick={async () => {
          setShow(false)
          const lang = hermes.language === "zh-CN" ? "zh-CN" : "en"
          await hermes.ipc.invoke("chat:queue-prompt", {
            text: buildBrainInstallPrompt(lang),
            mode: "new",
          })
          const url = (await hermes.settings.get<string>(BRAIN_URL_KEY, "")).trim()
          if (!url) await hermes.settings.set(BRAIN_URL_KEY, BRAIN_DEFAULT_URL)
        }}
      >
        {t("composer.brainHint")}
      </button>
    </div>
  )
}
