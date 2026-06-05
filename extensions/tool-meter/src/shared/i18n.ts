/**
 * Shared i18n + theme hooks — same pattern as the other extensions.
 * Catalog imports stay local to this extension so each can ship its
 * own translation keys without coordination.
 */

import { useEffect, useState } from "react"

import enCatalog from "../i18n/en.json"
import zhCNCatalog from "../i18n/zh-CN.json"
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
