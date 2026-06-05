/**
 * Shared i18n + theme hooks. Same pattern as the knowledge-base
 * extension so the two stay symmetric — switching language in the host
 * reactively re-renders both panels via the `hermes.on("language")`
 * subscription.
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
