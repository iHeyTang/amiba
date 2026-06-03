/**
 * Settings → Knowledge (Brain) — configuration pane for the gbrain
 * knowledge-base integration. Extension-local port of SettingsBrainConfig.
 *
 * Translation strategy for sub-components:
 *   All sub-components (InfoRow, ProviderRow, FieldGroup, FieldRow) are
 *   defined INSIDE the makeSettingsKnowledgeTab factory so they close over
 *   `host`. This avoids prop-drilling `host` into every sub-component and
 *   keeps all IPC / i18n calls on the same `host` reference.
 */

import { Check, Loader2, RefreshCw, RotateCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import type { RendererHost } from "@hermes-x/extension-api"
import { Button, Input, Label, ScrollArea } from "@hermes-x/ui"

import { BRAIN_DEFAULT_URL, BRAIN_TOKEN_KEY, BRAIN_URL_KEY } from "./brain-storage"
import { useTranslate } from "../i18n"

// ---------------------------------------------------------------------------
// IPC bridge types — mirrored from SettingsBrainConfig
// ---------------------------------------------------------------------------

interface BrainHealthInfo {
  status: string
  version?: string
  db?: string
  transport?: string
  engine?: string
}

interface GBrainProvider {
  id: string
  tier: string
  embed: string
  expand: string
  chat: string
  ready: boolean
  missing_env?: string
  status_raw: string
}

interface ListProvidersResult {
  ok: boolean
  providers?: GBrainProvider[]
  binary: string
  error?: string
}

interface EnsureResult {
  ok: boolean
  started: boolean
  alreadyRunning: boolean
  binary: string
  pid?: number
  error?: string
}

interface ProviderEnvResult {
  ok: boolean
  schema?: { required: string[]; optional: string[]; setupUrl?: string }
  binary: string
  error?: string
}

interface OverridesListResult {
  ok: boolean
  overrides?: Record<string, string[]>
  error?: string
}

interface OverrideSetResult {
  ok: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Component factory
// ---------------------------------------------------------------------------

export function makeSettingsKnowledgeTab(host: RendererHost) {
  // -------------------------------------------------------------------------
  // Sub-components — defined inside factory to close over `host`
  // -------------------------------------------------------------------------

  function InfoRow({ label, value }: { label: string; value: string | undefined }) {
    return (
      <div className="flex items-baseline gap-2">
        <dt className="shrink-0 text-muted-foreground">{label}</dt>
        <dd className="min-w-0 flex-1 truncate font-mono text-[11px]">
          {value || "—"}
        </dd>
      </div>
    )
  }

  function FieldRow({
    providerId,
    envKey,
    saved,
    onChanged,
  }: {
    providerId: string
    envKey: string
    saved: boolean
    onChanged: () => void
  }) {
    const t = useTranslate(host)
    const [value, setValue] = useState("")
    const [busy, setBusy] = useState(false)
    const [justSaved, setJustSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const save = useCallback(async () => {
      if (value.length === 0) return
      setBusy(true)
      setError(null)
      setJustSaved(false)
      try {
        const r = await host.ipc.invoke<
          { providerId: string; envKey: string; value: string },
          OverrideSetResult
        >("providers.overrides.set", { providerId, envKey, value })
        if (!r.ok) {
          setError(r.error ?? "save failed")
          return
        }
        setValue("")
        setJustSaved(true)
        onChanged()
      } finally {
        setBusy(false)
      }
    }, [providerId, envKey, value, onChanged])

    const clear = useCallback(async () => {
      setBusy(true)
      setError(null)
      setJustSaved(false)
      try {
        const r = await host.ipc.invoke<
          { providerId: string; envKey: string },
          OverrideSetResult
        >("providers.overrides.unset", { providerId, envKey })
        if (!r.ok) {
          setError(r.error ?? "clear failed")
          return
        }
        onChanged()
      } finally {
        setBusy(false)
      }
    }, [providerId, envKey, onChanged])

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label
            htmlFor={`provider-env-${providerId}-${envKey}`}
            className="w-44 shrink-0 font-mono text-[10px]"
          >
            {envKey}
          </Label>
          <Input
            id={`provider-env-${providerId}-${envKey}`}
            type="password"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setJustSaved(false)
            }}
            placeholder={
              saved
                ? t("config.providers.placeholder.saved")
                : t("config.providers.placeholder.empty")
            }
            className="h-7 flex-1 text-xs"
            disabled={busy}
          />
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => void save()}
            disabled={busy || value.length === 0}
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              t("config.providers.save")
            )}
          </Button>
          {saved && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => void clear()}
              disabled={busy}
            >
              {t("config.providers.clear")}
            </Button>
          )}
        </div>
        {error && <p className="text-[10px] text-destructive">{error}</p>}
        {justSaved && !error && (
          <p className="text-[10px] text-[hsl(var(--success))]">
            {t("config.providers.saved")}
          </p>
        )}
      </div>
    )
  }

  function FieldGroup({
    title,
    keys,
    providerId,
    savedKeys,
    onChanged,
  }: {
    title: string
    keys: string[]
    providerId: string
    savedKeys: string[]
    onChanged: () => void
  }) {
    return (
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        <div className="space-y-1.5">
          {keys.map((k) => (
            <FieldRow
              key={k}
              providerId={providerId}
              envKey={k}
              saved={savedKeys.includes(k)}
              onChanged={onChanged}
            />
          ))}
        </div>
      </div>
    )
  }

  function ProviderRow({
    provider,
    savedKeys,
    onChanged,
  }: {
    provider: GBrainProvider
    savedKeys: string[]
    onChanged: () => void
  }) {
    const t = useTranslate(host)
    const [open, setOpen] = useState(false)
    const [schema, setSchema] = useState<{
      required: string[]
      optional: string[]
      setupUrl?: string
    } | null>(null)
    const [schemaLoading, setSchemaLoading] = useState(false)
    const [schemaError, setSchemaError] = useState<string | null>(null)

    useEffect(() => {
      if (!open || schema || schemaLoading) return
      setSchemaLoading(true)
      setSchemaError(null)
      void host.ipc
        .invoke<string, ProviderEnvResult>("providers.env", provider.id)
        .then((r) => {
          if (!r.ok) setSchemaError(r.error ?? "failed to load schema")
          else setSchema(r.schema ?? null)
        })
        .finally(() => setSchemaLoading(false))
    }, [open, schema, schemaLoading, provider.id])

    const capabilityChip = (label: string, on: boolean) =>
      on ? (
        <span
          className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
          title={label}
        >
          {label}
        </span>
      ) : null

    return (
      <div className="rounded border border-border/40 bg-background/40 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">{provider.id}</span>
          <span
            className="rounded bg-muted/60 px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
            title={provider.tier}
          >
            {provider.tier}
          </span>
          <span className="flex items-center gap-1">
            {capabilityChip("embed", provider.embed === "yes")}
            {capabilityChip("expand", provider.expand === "yes")}
            {capabilityChip("chat", provider.chat === "yes")}
          </span>
          <span
            className={`ml-auto shrink-0 text-[10px] ${
              provider.ready || savedKeys.length > 0
                ? "text-[hsl(var(--success))]"
                : "text-muted-foreground"
            }`}
            title={provider.status_raw}
          >
            {provider.ready
              ? "✓ ready"
              : savedKeys.length > 0
                ? `✓ saved (${savedKeys.length})`
                : `✗ ${provider.missing_env ?? "setup"}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setOpen((v) => !v)}
          >
            {open
              ? t("config.providers.collapse")
              : t("config.providers.expand")}
          </Button>
        </div>

        {open && (
          <div className="mt-2 border-t border-border/30 pt-2">
            {schemaLoading && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("config.providers.loading")}
              </div>
            )}
            {schemaError && (
              <p className="text-[11px] text-destructive">{schemaError}</p>
            )}
            {schema && (
              <div className="space-y-3">
                {schema.required.length > 0 && (
                  <FieldGroup
                    title={t("config.providers.required")}
                    keys={schema.required}
                    providerId={provider.id}
                    savedKeys={savedKeys}
                    onChanged={onChanged}
                  />
                )}
                {schema.optional.length > 0 && (
                  <FieldGroup
                    title={t("config.providers.optional")}
                    keys={schema.optional}
                    providerId={provider.id}
                    savedKeys={savedKeys}
                    onChanged={onChanged}
                  />
                )}
                {schema.setupUrl && (
                  <a
                    href={schema.setupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-primary hover:underline"
                  >
                    {t("config.providers.setupLink")}
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Main component
  // -------------------------------------------------------------------------

  return function SettingsKnowledgeTab() {
    const t = useTranslate(host)
    const [url, setUrl] = useState(BRAIN_DEFAULT_URL)
    const [token, setToken] = useState("")
    const [healthInfo, setHealthInfo] = useState<BrainHealthInfo | null>(null)
    const [connecting, setConnecting] = useState(false)
    const [starting, setStarting] = useState(false)
    const [connectionError, setConnectionError] = useState<string | null>(null)
    const [bootLoading, setBootLoading] = useState(true)
    const [dirty, setDirty] = useState(false)
    const [saved, setSaved] = useState(false)
    const [restarting, setRestarting] = useState(false)
    const [restarted, setRestarted] = useState(false)

    const [providers, setProviders] = useState<GBrainProvider[]>([])
    const [providersLoading, setProvidersLoading] = useState(false)
    const [providersError, setProvidersError] = useState<string | null>(null)

    const [overrideKeys, setOverrideKeys] = useState<Record<string, string[]>>({})

    const refreshOverrides = useCallback(async () => {
      try {
        const r = await host.ipc.invoke<
          undefined,
          OverridesListResult
        >("providers.overrides.list", undefined)
        if (r.ok) setOverrideKeys(r.overrides ?? {})
      } catch {
        // ignore — overrides are optional capability
      }
    }, [])

    useEffect(() => {
      void refreshOverrides()
    }, [refreshOverrides])

    // Boot
    useEffect(() => {
      void (async () => {
        try {
          const savedUrl = await host.settings.get<string>(BRAIN_URL_KEY, "")
          const savedToken = await host.settings.get<string>(BRAIN_TOKEN_KEY, "")
          if (savedUrl) setUrl(savedUrl)
          if (savedToken) setToken(savedToken)

          let h: BrainHealthInfo | null = null
          try {
            h = await host.ipc.invoke<void, BrainHealthInfo | null>("health", undefined)
          } catch {
            // ignore
          }
          if (!h) {
            setStarting(true)
            try {
              const r = await host.ipc.invoke<void, EnsureResult | null>("launcher.ensure", undefined)
              if (r && !r.ok) {
                setConnectionError(
                  t("connection.error", {
                    error: r.error ?? "ensure failed",
                  }),
                )
              } else {
                try {
                  h = await host.ipc.invoke<void, BrainHealthInfo | null>("health", undefined)
                } catch {
                  // ignore
                }
              }
            } catch {
              // ensure not available on this host
            } finally {
              setStarting(false)
            }
          }
          if (h) setHealthInfo(h)
        } finally {
          setBootLoading(false)
        }
      })()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const refreshProviders = useCallback(async () => {
      setProvidersLoading(true)
      setProvidersError(null)
      try {
        const r = await host.ipc.invoke<
          undefined,
          ListProvidersResult
        >("providers.list", undefined)
        if (!r.ok) {
          setProvidersError(r.error ?? "Failed to list gbrain providers")
          setProviders([])
          return
        }
        setProviders(r.providers ?? [])
      } catch {
        // providers bridge not available on this host — silently skip
        setProviders([])
      } finally {
        setProvidersLoading(false)
      }
    }, [])

    useEffect(() => {
      void refreshProviders()
    }, [refreshProviders])

    const testConnection = useCallback(
      async ({ persist }: { persist: boolean }) => {
        setConnecting(true)
        setConnectionError(null)
        setSaved(false)
        try {
          const u = url.trim()
          const tk = token.trim()
          if (persist) {
            await host.settings.set(BRAIN_URL_KEY, u)
            await host.settings.set(BRAIN_TOKEN_KEY, tk)
            setDirty(false)
          }
          let h: BrainHealthInfo | null = null
          try {
            h = await host.ipc.invoke<void, BrainHealthInfo | null>("health", undefined)
          } catch {
            // ignore
          }
          if (!h) {
            setStarting(true)
            try {
              const r = await host.ipc.invoke<void, EnsureResult | null>("launcher.ensure", undefined)
              if (r && !r.ok) {
                setHealthInfo(null)
                setConnectionError(
                  t("connection.error", {
                    error: r.error ?? "ensure failed",
                  }),
                )
                return
              }
              try {
                h = await host.ipc.invoke<void, BrainHealthInfo | null>("health", undefined)
              } catch {
                // ignore
              }
            } catch {
              // ensure not available
            } finally {
              setStarting(false)
            }
          }
          if (!h) {
            setHealthInfo(null)
            setConnectionError(t("connection.failed"))
            return
          }
          try {
            const auth = await host.ipc.invoke<
              void,
              { ok: boolean; reason?: string; error?: string }
            >("verify-auth", undefined)
            if (!auth.ok) {
              setHealthInfo(null)
              setConnectionError(
                auth.reason === "invalid-token"
                  ? t("connection.invalidToken")
                  : t("connection.error", { error: auth.error ?? "" }),
              )
              return
            }
          } catch {
            // verify-auth not available — treat as ok
          }
          setHealthInfo(h)
          if (persist) setSaved(true)
        } catch (e) {
          setHealthInfo(null)
          setConnectionError(
            t("connection.error", {
              error: (e as Error).message ?? String(e),
            }),
          )
        } finally {
          setConnecting(false)
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [url, token],
    )

    const restart = useCallback(async () => {
      setRestarting(true)
      setRestarted(false)
      setConnectionError(null)
      setSaved(false)
      try {
        const r = await host.ipc.invoke<void, EnsureResult | null>("launcher.restart", undefined)
        if (r && !r.ok) {
          setConnectionError(
            t("config.restart.failed", {
              error: r.error ?? "unknown error",
            }),
          )
          return
        }
        setRestarted(true)
      } catch {
        // restart not available on this host
        setRestarted(true)
      } finally {
        setRestarting(false)
      }
      await testConnection({ persist: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [testConnection])

    const connected = !!healthInfo

    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Pane header */}
        <header className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-3">
          <div className="flex min-w-0 flex-col justify-center gap-0.5 leading-tight">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {t("config.title")}
            </h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {t("config.subtitle")}
            </p>
          </div>
          {bootLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : connected ? (
            <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--success))]">
              <Check className="h-3 w-3" />
              {t("connected")}
              {healthInfo?.version && (
                <span className="text-muted-foreground">
                  v{healthInfo.version}
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t("config.notConnected")}
            </span>
          )}
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 p-6">
            {/* Connection */}
            <section className="space-y-3 rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-medium">
                {t("connection.title")}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="brain-config-url" className="text-xs">
                    {t("connection.url")}
                  </Label>
                  <Input
                    id="brain-config-url"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value)
                      setDirty(true)
                      setSaved(false)
                    }}
                    placeholder={BRAIN_DEFAULT_URL}
                    className="h-8 font-mono text-xs"
                    disabled={bootLoading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brain-config-token" className="text-xs">
                    {t("connection.token")}
                  </Label>
                  <Input
                    id="brain-config-token"
                    type="password"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value)
                      setDirty(true)
                      setSaved(false)
                    }}
                    placeholder={t("connection.token.placeholder")}
                    className="h-8 text-xs"
                    disabled={bootLoading}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  onClick={() => void testConnection({ persist: true })}
                  disabled={connecting || restarting || bootLoading}
                  size="sm"
                >
                  {connecting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {dirty
                    ? t("config.saveAndTest")
                    : t("connection.test")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void restart()}
                  disabled={restarting || connecting || bootLoading}
                  title={t("config.restart.hint")}
                  size="sm"
                >
                  {restarting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {restarting
                    ? t("config.restarting")
                    : t("config.restart")}
                </Button>
                {starting && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("connection.starting")}
                  </span>
                )}
                {!starting && connectionError && (
                  <span className="text-xs text-destructive">
                    {connectionError}
                  </span>
                )}
                {!starting && saved && !connectionError && (
                  <span className="text-xs text-[hsl(var(--success))]">
                    {t("config.saved")}
                  </span>
                )}
                {!starting && restarted && !connectionError && !saved && (
                  <span className="text-xs text-[hsl(var(--success))]">
                    {t("config.restarted")}
                  </span>
                )}
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t("config.hint")}
              </p>
            </section>

            {/* Runtime info */}
            <section className="space-y-3 rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-medium">
                {t("config.runtime.title")}
              </h3>
              {connected ? (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                  <InfoRow
                    label={t("config.runtime.version")}
                    value={healthInfo?.version}
                  />
                  <InfoRow
                    label={t("config.runtime.engine")}
                    value={healthInfo?.engine}
                  />
                  <InfoRow
                    label={t("config.runtime.transport")}
                    value={healthInfo?.transport}
                  />
                  <InfoRow
                    label={t("config.runtime.db")}
                    value={healthInfo?.db}
                  />
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("config.runtime.empty")}
                </p>
              )}
            </section>

            {/* Providers */}
            {providers.length > 0 || providersLoading ? (
              <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium">
                      {t("config.providers.section")}
                    </h3>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {t("config.providers.envHint")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => void refreshProviders()}
                    disabled={providersLoading}
                  >
                    {providersLoading ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    )}
                    {t("config.providers.refresh")}
                  </Button>
                </div>

                {providersLoading && providers.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("config.providers.loading")}
                  </div>
                ) : providersError ? (
                  <p className="text-xs text-destructive">{providersError}</p>
                ) : providers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("config.providers.empty")}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {providers.map((p) => (
                      <ProviderRow
                        key={p.id}
                        provider={p}
                        savedKeys={overrideKeys[p.id] ?? []}
                        onChanged={refreshOverrides}
                      />
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    )
  }
}
