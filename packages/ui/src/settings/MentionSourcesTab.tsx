import {
  getMentionSources,
  installMentionSource,
  removeMentionSource,
  updateMentionSource,
  type MentionSourceInfo,
} from "@amiba/core"
import { RefreshCw, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { useT } from "@amiba/i18n"
import { Button, Input, cn } from "../primitives"

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; sources: MentionSourceInfo[] }

/**
 * Manage the desktop composer's @-mention sources. Each source is a git repo
 * under ~/.hermes/mention-sources/; lifecycle is plain git via the backplane
 * admin routes (install = clone, update = pull, remove = rm). This is NOT a
 * hermes plugin/connector surface — see backend/docs/mention-sources.md.
 */
export function MentionSourcesTab() {
  const { t } = useT()
  const [state, setState] = useState<State>({ kind: "loading" })
  const [gitUrl, setGitUrl] = useState("")
  const [busy, setBusy] = useState<string | null>(null) // source name or "install"
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await getMentionSources()
    setState(res.ok ? { kind: "loaded", sources: res.sources } : { kind: "error" })
  }, [])

  useEffect(() => {
    setState({ kind: "loading" })
    void refresh()
  }, [refresh])

  async function onInstall() {
    const url = gitUrl.trim()
    if (!url || busy) return
    setBusy("install")
    setError(null)
    const res = await installMentionSource({ from_git: url })
    setBusy(null)
    if (!res.ok) {
      setError(t("options.mentionSources.installError", { error: res.error ?? "unknown" }))
      return
    }
    setGitUrl("")
    if (res.loadWarning) {
      setError(t("options.mentionSources.loadWarning", { name: res.name ?? "", warning: res.loadWarning }))
    }
    await refresh()
  }

  async function onUpdate(name: string) {
    if (busy) return
    setBusy(name)
    setError(null)
    const res = await updateMentionSource(name)
    setBusy(null)
    if (!res.ok) setError(t("options.mentionSources.updateError", { error: res.error ?? "unknown" }))
    else await refresh()
  }

  async function onRemove(name: string) {
    if (busy) return
    if (!confirm(t("options.mentionSources.removeConfirm", { name }))) return
    setBusy(name)
    setError(null)
    const res = await removeMentionSource(name)
    setBusy(null)
    if (!res.ok) setError(t("options.mentionSources.removeError", { error: res.error ?? "unknown" }))
    else await refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("options.mentionSources.title")}</p>

      {/* Install from git */}
      <div className="flex items-center gap-2">
        <Input
          value={gitUrl}
          onChange={(e) => setGitUrl(e.target.value)}
          placeholder={t("options.mentionSources.installPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onInstall()
          }}
          className="max-w-md"
        />
        <Button size="sm" onClick={() => void onInstall()} disabled={busy === "install" || !gitUrl.trim()}>
          {busy === "install" ? t("options.mentionSources.installing") : t("options.mentionSources.install")}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {state.kind === "loading" && (
        <p className="text-sm text-muted-foreground">{t("options.mentionSources.loading")}</p>
      )}
      {state.kind === "error" && (
        <p className="text-sm text-muted-foreground">{t("options.mentionSources.error")}</p>
      )}
      {state.kind === "loaded" &&
        (state.sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("options.mentionSources.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border bg-card">
            {state.sources.map((s) => (
              <SourceRow
                key={s.name}
                s={s}
                busy={busy === s.name}
                onUpdate={() => void onUpdate(s.name)}
                onRemove={() => void onRemove(s.name)}
              />
            ))}
          </ul>
        ))}
    </div>
  )
}

function SourceRow({
  s,
  busy,
  onUpdate,
  onRemove,
}: {
  s: MentionSourceInfo
  busy: boolean
  onUpdate: () => void
  onRemove: () => void
}) {
  const { t } = useT()
  return (
    <li className={cn("flex items-start justify-between gap-2 p-3", busy && "opacity-50")}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.name}</span>
          {!s.has_search && (
            <span
              className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600"
              title={t("options.mentionSources.noSearchHint")}
            >
              {t("options.mentionSources.noSearch")}
            </span>
          )}
          {s.origin?.method === "git" ? (
            <span
              className="shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-600"
              title={s.origin.url ?? ""}
            >
              git
            </span>
          ) : s.origin?.method === "path" ? (
            <span
              className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600"
              title={t("options.mentionSources.localHint", { path: s.origin.path ?? "" })}
            >
              {t("options.mentionSources.local")}
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t("options.mentionSources.legacy")}
            </span>
          )}
        </div>
        {s.description && (
          <span className="truncate text-xs text-muted-foreground">{s.description}</span>
        )}
        <code className="text-[11px] text-muted-foreground">
          {s.name}
          {s.version ? ` · v${s.version}` : ""}
        </code>
        {(s.origin?.url || s.origin?.path) && (
          <code className="truncate text-[11px] text-muted-foreground/70">
            ↪ {s.origin.url ?? s.origin.path}
          </code>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onUpdate}
          title={
            s.origin?.method === "path"
              ? t("options.mentionSources.reload")
              : t("options.mentionSources.update")
          }
        >
          <RefreshCw />
          {s.origin?.method === "path"
            ? t("options.mentionSources.reload")
            : t("options.mentionSources.update")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onRemove}
          title={t("options.mentionSources.remove")}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}
