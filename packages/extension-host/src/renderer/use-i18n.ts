import { useEffect, useMemo, useState } from "react"
import type { RendererHost } from "@hermes-x/extension-api"

export type Catalog = Record<string, string>
export type CatalogMap = Record<string, Catalog>

export type Translator = (
  key: string,
  params?: Record<string, unknown>,
) => string

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k]
    return v === undefined || v === null ? `{${k}}` : String(v)
  })
}

/**
 * Extension-side i18n helper.
 *
 * Extensions own their translation tables — bundle the JSON catalogs at
 * import time, then call `useI18n(host, catalogs)` inside a React component.
 * The returned `t(key, params?)` looks up the key in the catalog matching
 * the host's current language; if absent it falls back to the `en` catalog,
 * then to the bare key string.
 *
 * The hook subscribes to `host.i18n.subscribe(...)`, so when the user
 * switches the app locale the consuming component re-renders automatically.
 *
 * Example:
 *
 *     import en from "../i18n/en.json"
 *     import zhCN from "../i18n/zh-CN.json"
 *
 *     const CATALOGS = { en, "zh-CN": zhCN }
 *
 *     function MyPanel({ host }: { host: RendererHost }) {
 *       const t = useI18n(host, CATALOGS)
 *       return <h1>{t("panel.title")}</h1>
 *     }
 */
export function useI18n(host: RendererHost, catalogs: CatalogMap): Translator {
  const [lang, setLang] = useState<string>(host.i18n.language)
  useEffect(() => {
    setLang(host.i18n.language)
    const sub = host.i18n.subscribe((next) => setLang(next))
    return () => sub.dispose()
  }, [host])

  return useMemo<Translator>(() => {
    const primary = catalogs[lang] ?? catalogs.en ?? {}
    const fallback = catalogs.en ?? {}
    return (key, params) =>
      interpolate(primary[key] ?? fallback[key] ?? key, params)
  }, [lang, catalogs])
}
