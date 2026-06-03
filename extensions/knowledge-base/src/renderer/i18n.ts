/**
 * Extension-owned i18n helper for the knowledge-base extension.
 *
 * Bundles the en / zh-CN catalogs at module load time and exposes a
 * `useTranslate(host)` thin wrapper around `useI18n(host, CATALOGS)` so
 * every component only needs a single import.
 */
import { useI18n } from "@hermes-x/extension-host/renderer"
import type { RendererHost } from "@hermes-x/extension-api"

import enCatalog from "../i18n/en.json"
import zhCNCatalog from "../i18n/zh-CN.json"

export const CATALOGS = {
  en: enCatalog,
  "zh-CN": zhCNCatalog,
} as const

export function useTranslate(host: RendererHost) {
  return useI18n(host, CATALOGS)
}
