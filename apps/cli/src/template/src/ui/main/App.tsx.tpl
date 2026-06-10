import { useEffect, useState } from "react"
import { hermes } from "../shared/hermes-bridge"
import enCatalog from "../../i18n/en.json"
import zhCNCatalog from "../../i18n/zh-CN.json"

const CATALOGS = { en: enCatalog, "zh-CN": zhCNCatalog }

function useT() {
  const [lang, setLang] = useState(hermes.language)
  useEffect(() => hermes.on("language", setLang), [])
  const catalog = (CATALOGS as Record<string, Record<string, string>>)[lang] ?? CATALOGS.en
  return (key: string) => catalog[key] ?? key
}

export function App() {
  const t = useT()
  return (
    <div style={{ padding: "1rem" }}>
      <h1>{t("panel.title")}</h1>
      <p>Hello from {{NAME}}.</p>
    </div>
  )
}
