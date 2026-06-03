import { useEffect, useState } from "react"
import type { RendererHost } from "@hermes-x/extension-api"
import { buildBrainInstallPrompt } from "./brain-install"
import { BRAIN_URL_KEY, BRAIN_DEFAULT_URL } from "./brain-storage"

export function makeBrainDisconnectedHint(host: RendererHost) {
  return function BrainDisconnectedHint(props: {
    onPrefill?: (text: string) => void
    language?: "en" | "zh-CN"
  }) {
    const [show, setShow] = useState(false)
    useEffect(() => {
      let cancelled = false
      void (async () => {
        try {
          const h = await host.ipc.invoke<void, { status: string } | null>("health", undefined)
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
    return (
      <button
        type="button"
        className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground hover:bg-foreground/5"
        onClick={async () => {
          setShow(false)
          const lang = props.language ?? "en"
          props.onPrefill?.(buildBrainInstallPrompt(lang))
          const url = (await host.settings.get<string>(BRAIN_URL_KEY, "")).trim()
          if (!url) await host.settings.set(BRAIN_URL_KEY, BRAIN_DEFAULT_URL)
        }}
      >
        {host.i18n.t("composer.brainHint")}
      </button>
    )
  }
}
