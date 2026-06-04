/**
 * Inline i18n + theme hooks shared between the main and settings pages.
 *
 * Both pages load their own React tree but share the same i18n catalogs
 * and the same theme broker, so keeping two copies of `useT()` /
 * `useTheme()` just invited drift. The hooks here read directly from
 * the `hermes` bridge and re-render on language/theme change.
 */

import { useEffect, useState } from "react"

import enCatalog from "../../i18n/en.json"
import zhCNCatalog from "../../i18n/zh-CN.json"
import { hermes } from "./hermes-bridge"

export function useT(): (k: string, vars?: Record<string, string>) => string {
  const [lang, setLang] = useState<string>(() => hermes.language)
  useEffect(() => {
    setLang(hermes.language)
    return hermes.on("language", setLang)
  }, [])
  const catalog =
    lang === "zh-CN"
      ? (zhCNCatalog as Record<string, string>)
      : (enCatalog as Record<string, string>)
  return (k: string, vars?: Record<string, string>): string => {
    let str = catalog[k] ?? k
    if (vars) {
      for (const [key, val] of Object.entries(vars)) {
        str = str.replaceAll(`{${key}}`, val)
      }
    }
    return str
  }
}

export function useTheme(): void {
  useEffect(() => {
    const apply = (theme: string) => {
      document.documentElement.classList.toggle("dark", theme === "dark")
    }
    apply(hermes.theme)
    return hermes.on("theme", apply)
  }, [])
}
