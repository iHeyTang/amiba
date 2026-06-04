/**
 * Onboarding card for the two stages where gbrain isn't reachable:
 *
 *   not-installed  binary missing entirely
 *   stopped        binary exists but the daemon isn't up
 *
 * Both the main panel and the settings page need an identical pane in
 * these stages — there's no point letting the user configure providers
 * if the service can't even be talked to. Centralising the card here
 * keeps copy + icons + actions in lockstep across both surfaces.
 *
 * The card owns its own connecting/error state and pushes the post-action
 * lifecycle probe back up via `onProbeUpdate` so the parent can transition
 * out of the disconnected branch when the user succeeds.
 */

import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button, Input, Label } from "@hermes-x/ui"

import { BRAIN_DEFAULT_URL, BRAIN_TOKEN_KEY, BRAIN_URL_KEY } from "../../main/lib/constants"
import { buildBrainInstallPrompt } from "../../main/lib/brain-install-ui"
import { hermes } from "./hermes-bridge"
import { useT } from "./i18n"
import type { LifecycleProbe } from "./lifecycle"

interface Props {
  stage: "not-installed" | "stopped"
  onProbeUpdate: (probe: LifecycleProbe) => void
}

export function DisconnectedCard({ stage, onProbeUpdate }: Props) {
  const t = useT()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reprobe = useCallback(async () => {
    try {
      const probe = await hermes.ipc.invoke<LifecycleProbe>("lifecycle.probe")
      onProbeUpdate(probe)
    } catch {
      // Swallow — parent stays in its current stage; the user can
      // retry by clicking the action button again.
    }
  }, [onProbeUpdate])

  const startServe = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      const r = await hermes.ipc.invoke<
        { ok: boolean; error?: string } | null
      >("launcher.ensure")
      if (r && !r.ok) {
        setError(
          t("connection.error", { error: r.error ?? "ensure failed" }),
        )
      }
      await reprobe()
    } catch (e) {
      setError(
        t("connection.error", { error: (e as Error).message ?? String(e) }),
      )
    } finally {
      setConnecting(false)
    }
  }, [t, reprobe])

  const startOneClickInstall = useCallback(async () => {
    setError(null)
    try {
      const existingUrl = (
        await hermes.settings.get<string>(BRAIN_URL_KEY, "")
      ).trim()
      if (!existingUrl) {
        await hermes.settings.set(BRAIN_URL_KEY, BRAIN_DEFAULT_URL)
      }
      await hermes.ipc.invoke("chat:queue-prompt", {
        text: buildBrainInstallPrompt(hermes.language === "zh-CN" ? "zh-CN" : "en"),
        mode: "new",
      })
    } catch (e) {
      setError(
        t("connection.error", { error: (e as Error).message ?? String(e) }),
      )
    }
  }, [t])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="flex w-full justify-center px-6 pt-[12vh] pb-10">
        <div className="flex w-full max-w-xl flex-col gap-5">
          {stage === "not-installed" ? (
            <NotInstalled
              t={t}
              connecting={connecting}
              error={error}
              onInstall={() => void startOneClickInstall()}
            />
          ) : (
            <Stopped
              t={t}
              connecting={connecting}
              error={error}
              onStart={() => void startServe()}
            />
          )}
          <AdvancedSection
            t={t}
            connecting={connecting}
            onReprobe={reprobe}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Escape hatch for power users who want to install gbrain themselves
 * (their package manager of choice, a custom path, a remote instance,
 * etc.) and just point this client at a running server. Hidden behind
 * a collapse so the primary "one-click install" path stays the visible
 * default for everyone else.
 */
function AdvancedSection({
  t,
  connecting,
  onReprobe,
}: {
  t: (k: string, vars?: Record<string, string>) => string
  connecting: boolean
  onReprobe: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(BRAIN_DEFAULT_URL)
  const [token, setToken] = useState("")
  const [tokenVisible, setTokenVisible] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const storedUrl = await hermes.settings.get<string>(BRAIN_URL_KEY, "")
      if (storedUrl) setUrl(storedUrl)
      const storedToken = await hermes.settings.get<string>(BRAIN_TOKEN_KEY, "")
      if (storedToken) setToken(storedToken)
    })()
  }, [])

  const saveAndReprobe = useCallback(async () => {
    setBusy(true)
    setSavedFlash(false)
    try {
      await hermes.settings.set(BRAIN_URL_KEY, url.trim())
      await hermes.settings.set(BRAIN_TOKEN_KEY, token.trim())
      await onReprobe()
      setSavedFlash(true)
    } finally {
      setBusy(false)
    }
  }, [url, token, onReprobe])

  return (
    <div className="rounded-lg border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5" />
          {t("tutorial.advanced.label")}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/60 p-3">
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t("tutorial.advanced.hint")}
          </p>
          <div className="space-y-1">
            <Label htmlFor="brain-url-advanced" className="text-xs">
              {t("connection.url")}
            </Label>
            <Input
              id="brain-url-advanced"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setSavedFlash(false)
              }}
              placeholder={BRAIN_DEFAULT_URL}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="brain-token-advanced" className="text-xs">
              {t("connection.token")}
            </Label>
            <div className="relative">
              <Input
                id="brain-token-advanced"
                type={tokenVisible ? "text" : "password"}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  setSavedFlash(false)
                }}
                placeholder={t("connection.token.placeholder")}
                className="h-8 pr-8 text-xs"
              />
              <button
                type="button"
                onClick={() => setTokenVisible((v) => !v)}
                className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                aria-label={tokenVisible ? t("connection.token.hide") : t("connection.token.show")}
                title={tokenVisible ? t("connection.token.hide") : t("connection.token.show")}
              >
                {tokenVisible ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              {t("connection.token.hint")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void saveAndReprobe()}
              disabled={busy || connecting}
              size="sm"
              variant="outline"
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("connection.test")}
            </Button>
            {savedFlash && (
              <span className="text-xs text-[hsl(var(--success))]">
                {t("config.saved")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface CardProps {
  t: (k: string, vars?: Record<string, string>) => string
  connecting: boolean
  error: string | null
}

function NotInstalled({
  t,
  connecting: _connecting,
  error,
  onInstall,
}: CardProps & { onInstall: () => void }) {
  return (
    <>
      <header className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <BookOpen className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("tutorial.tagline")}</p>
      </header>
      <ul className="space-y-2 text-sm">
        {[
          t("tutorial.bullet.recall"),
          t("tutorial.bullet.link"),
          t("tutorial.bullet.context"),
        ].map((line, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="text-foreground/90">{line}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col items-center gap-1.5">
        <Button onClick={onInstall} size="lg" className="min-w-[200px]">
          <Sparkles className="mr-2 h-4 w-4" />
          {t("oneClick.button")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {t("oneClick.description")}
        </p>
        {error && (
          <p className="text-center text-xs text-destructive">{error}</p>
        )}
      </div>
    </>
  )
}

function Stopped({
  t,
  connecting,
  error,
  onStart,
}: CardProps & { onStart: () => void }) {
  return (
    <>
      <header className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <Download className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          {t("stage.stopped.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("stage.stopped.description")}
        </p>
      </header>
      <div className="flex flex-col items-center gap-1.5">
        <Button
          onClick={onStart}
          disabled={connecting}
          size="lg"
          className="min-w-[200px]"
        >
          {connecting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {connecting ? t("stage.stopped.starting") : t("stage.stopped.button")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {t("stage.stopped.hint")}
        </p>
        {error && (
          <p className="text-center text-xs text-destructive">{error}</p>
        )}
      </div>
    </>
  )
}
