import type { RendererHost } from "@hermes-x/extension-api"
import { useI18n } from "@hermes-x/extension-host/renderer"
import enCatalog from "../../i18n/en.json"
import zhCNCatalog from "../../i18n/zh-CN.json"

const CATALOGS = {
  en: enCatalog,
  "zh-CN": zhCNCatalog,
} as const

interface Props {
  host: RendererHost
}

export default function HelloPanel({ host }: Props) {
  const t = useI18n(host, CATALOGS)

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{t("panel.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("panel.subtitle")}</p>
    </div>
  )
}
