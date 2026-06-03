import { useExtensionRegistry } from "@hermes-x/extension-host/renderer"
import { useT } from "@hermes-x/i18n"
import { cn } from "../primitives"

export function SettingsExtensions() {
  const { t } = useT()
  const items = useExtensionRegistry()
  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-semibold">{t("options.extensions.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("options.extensions.subtitle")}</p>
      <ul className="flex flex-col divide-y rounded-md border bg-card">
        {items.map((ext) => (
          <li key={ext.id} className="flex flex-col gap-1 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{ext.manifest.name}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  ext.status === "failed"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-emerald-500/15 text-emerald-600",
                )}
              >
                {ext.status === "failed"
                  ? t("options.extensions.status.failed")
                  : t("options.extensions.status.loaded")}
              </span>
            </div>
            <code className="text-xs text-muted-foreground">{ext.id} · v{ext.manifest.version}</code>
            {ext.error && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-destructive">{t("options.extensions.showError")}</summary>
                <pre className="mt-1 overflow-auto rounded bg-muted p-2 text-[11px]">{ext.error}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
