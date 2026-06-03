/**
 * Settings → Brain — dedicated configuration pane for the GBrain
 * knowledge-base integration.
 *
 * Three sections, all read-only or desktop-local:
 *
 *   1. **Connection** — URL + Token + live status from `GET /health`.
 *      Persisted via the desktop's own storage (not gbrain's), since
 *      these tell *the desktop* where to talk to gbrain, not how
 *      gbrain runs internally.
 *
 *   2. **Runtime** — read-only display of fields gbrain reports back
 *      via `/health` (version, engine, transport, db).
 *
 *   3. **Providers** — dynamic enumeration of gbrain's recipe registry
 *      via the `gbrain providers list` CLI subprocess, with each row
 *      expandable into an inline editor that writes per-provider env
 *      values into hermes-x's encrypted override store (`safeStorage`
 *      → `~/.hermes/provider-env.json`). The launcher merges those on
 *      top of `process.env` when spawning gbrain, so edits apply on
 *      the next restart without asking the user to maintain shell
 *      exports. gbrain itself is untouched — `gbrain config show`
 *      will not see these values.
 */

import { Check, Loader2, RefreshCw, RotateCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import {
  BRAIN_DEFAULT_URL,
  BRAIN_TOKEN_STORAGE_KEY,
  BRAIN_URL_STORAGE_KEY,
} from "@hermes-x/core"
import { useT } from "@hermes-x/i18n"
import { getPlatform } from "@hermes-x/platform"

import { Button, Input, Label, ScrollArea } from "../primitives"
import { SettingsPaneHeader } from "./SettingsPaneHeader"

interface BrainHealthInfo {
  status: string
  version?: string
  db?: string
  transport?: string
  engine?: string
}

/**
 * One row in `gbrain providers list`, parsed by the main-process
 * subprocess bridge. Capability columns are the literal strings the CLI
 * prints (`yes` / `—`); `ready` reflects whether the auth-env vars are
 * already populated in the process gbrain inherits.
 */
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

/**
 * Minimal IPC bridge type — full type lives in desktop's `global.d.ts`
 * which this package can't see at build time, so we restate the subset
 * we use.
 */
type VerifyAuthResult =
  | { ok: true }
  | { ok: false; reason: "invalid-token" | "other"; error: string }

interface GBrainBridge {
  health: () => Promise<BrainHealthInfo | null>
  verifyAuth?: () => Promise<VerifyAuthResult>
  providers?: {
    list: () => Promise<ListProvidersResult>
    env: (id: string) => Promise<{
      ok: boolean
      schema?: { required: string[]; optional: string[]; setupUrl?: string }
      binary: string
      error?: string
    }>
    overrides: {
      list: () => Promise<{
        ok: boolean
        overrides?: Record<string, string[]>
        error?: string
      }>
      set: (
        providerId: string,
        envKey: string,
        value: string,
      ) => Promise<{ ok: boolean; error?: string }>
      unset: (
        providerId: string,
        envKey: string,
      ) => Promise<{ ok: boolean; error?: string }>
    }
  }
  launcher?: {
    ensure: () => Promise<EnsureResult>
    restart?: () => Promise<EnsureResult>
  }
}

function gbrainBridge(): GBrainBridge | undefined {
  return (window as unknown as { hermes?: { gbrain?: GBrainBridge } }).hermes
    ?.gbrain
}

function gbrainHealth(): Promise<BrainHealthInfo | null> {
  const bridge = gbrainBridge()
  if (!bridge) return Promise.resolve(null)
  return bridge.health()
}

/**
 * Probe the authenticated /mcp endpoint. Hosts that don't ship the
 * bridge (non-desktop) get a synthetic `ok: true` so the call collapses
 * to a no-op — `/health` already covered what those hosts can verify.
 */
function gbrainVerifyAuth(): Promise<VerifyAuthResult> {
  const bridge = gbrainBridge()?.verifyAuth
  if (!bridge) return Promise.resolve({ ok: true })
  return bridge()
}

/**
 * Make sure `gbrain serve --http` is running before we probe it.
 * Returns the launcher result (so callers can surface "Started"
 * vs "Already running" vs the spawn error) or `null` in hosts that
 * don't ship the launcher bridge (browser extension / web).
 */
async function restartGBrain(): Promise<EnsureResult | null> {
  const bridge = gbrainBridge()?.launcher
  if (!bridge?.restart) return null
  try {
    return await bridge.restart()
  } catch (e) {
    return {
      ok: false,
      started: false,
      alreadyRunning: false,
      binary: "",
      error: (e as Error).message ?? String(e),
    }
  }
}

async function ensureGBrain(): Promise<EnsureResult | null> {
  const bridge = gbrainBridge()?.launcher
  if (!bridge) return null
  try {
    return await bridge.ensure()
  } catch (e) {
    return {
      ok: false,
      started: false,
      alreadyRunning: false,
      binary: "",
      error: (e as Error).message ?? String(e),
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsBrainConfig() {
  const { t } = useT()

  // Connection state ----------------------------------------------------------
  const [url, setUrl] = useState(BRAIN_DEFAULT_URL)
  const [token, setToken] = useState("")
  const [healthInfo, setHealthInfo] = useState<BrainHealthInfo | null>(null)
  const [connecting, setConnecting] = useState(false)
  /** True while the launcher subprocess is spawning gbrain. Distinct
   *  from `connecting` so we can tell the user "starting…" rather than
   *  "testing…" — the wait is much longer when we're spawning. */
  const [starting, setStarting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [bootLoading, setBootLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restarted, setRestarted] = useState(false)
  // Whether the host actually exposes a restart endpoint. We hide the
  // button entirely on hosts that don't (extension/web) — there's no
  // local server they could restart anyway.
  const canRestart = !!gbrainBridge()?.launcher?.restart

  // Providers state -----------------------------------------------------------
  const [providers, setProviders] = useState<GBrainProvider[]>([])
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providersError, setProvidersError] = useState<string | null>(null)
  const hasProvidersBridge = !!gbrainBridge()?.providers

  const [overrideKeys, setOverrideKeys] = useState<Record<string, string[]>>({})

  const refreshOverrides = useCallback(async () => {
    const bridge = gbrainBridge()?.providers?.overrides
    if (!bridge) return
    const r = await bridge.list()
    if (r.ok) setOverrideKeys(r.overrides ?? {})
  }, [])

  useEffect(() => {
    void refreshOverrides()
  }, [refreshOverrides])

  // Boot ----------------------------------------------------------------------
  useEffect(() => {
    void (async () => {
      try {
        const r = await getPlatform().storage.get([
          BRAIN_URL_STORAGE_KEY,
          BRAIN_TOKEN_STORAGE_KEY,
        ])
        const savedUrl =
          typeof r[BRAIN_URL_STORAGE_KEY] === "string"
            ? (r[BRAIN_URL_STORAGE_KEY] as string)
            : ""
        const savedToken =
          typeof r[BRAIN_TOKEN_STORAGE_KEY] === "string"
            ? (r[BRAIN_TOKEN_STORAGE_KEY] as string)
            : ""
        if (savedUrl) setUrl(savedUrl)
        if (savedToken) setToken(savedToken)
        // Quick probe first — if main-process autostart has already
        // brought gbrain up, we land here connected without spawning a
        // second time. Otherwise call ensure() to kick the daemon and
        // wait for it.
        let h = await gbrainHealth()
        if (!h) {
          setStarting(true)
          const r = await ensureGBrain()
          setStarting(false)
          if (r && !r.ok) {
            setConnectionError(
              t("options.brain.connection.error", {
                error: r.error ?? "ensure failed",
              }),
            )
          } else {
            h = await gbrainHealth()
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
    const bridge = gbrainBridge()?.providers
    if (!bridge) return
    setProvidersLoading(true)
    setProvidersError(null)
    try {
      const r = await bridge.list()
      if (!r.ok) {
        setProvidersError(r.error ?? "Failed to list gbrain providers")
        setProviders([])
        return
      }
      setProviders(r.providers ?? [])
    } catch (e) {
      setProvidersError((e as Error).message ?? String(e))
    } finally {
      setProvidersLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshProviders()
  }, [refreshProviders])

  // Connection actions --------------------------------------------------------
  const testConnection = useCallback(
    async ({ persist }: { persist: boolean }) => {
      setConnecting(true)
      setConnectionError(null)
      setSaved(false)
      try {
        const u = url.trim()
        const tk = token.trim()
        if (persist) {
          await getPlatform().storage.set({
            [BRAIN_URL_STORAGE_KEY]: u,
            [BRAIN_TOKEN_STORAGE_KEY]: tk,
          })
          setDirty(false)
        }
        // Probe first — if gbrain is already up, no need to spawn.
        let h = await gbrainHealth()
        if (!h) {
          setStarting(true)
          const r = await ensureGBrain()
          setStarting(false)
          if (r && !r.ok) {
            setHealthInfo(null)
            setConnectionError(
              t("options.brain.connection.error", {
                error: r.error ?? "ensure failed",
              }),
            )
            return
          }
          h = await gbrainHealth()
        }
        if (!h) {
          setHealthInfo(null)
          setConnectionError(t("options.brain.connection.failed"))
          return
        }
        // /health is unauthenticated, so a passing probe doesn't prove
        // the token is good. Follow up with an authenticated MCP
        // initialize so an invalid token surfaces here instead of at
        // the first real tool call.
        const auth = await gbrainVerifyAuth()
        if (!auth.ok) {
          setHealthInfo(null)
          setConnectionError(
            auth.reason === "invalid-token"
              ? t("options.brain.connection.invalidToken")
              : t("options.brain.connection.error", { error: auth.error }),
          )
          return
        }
        setHealthInfo(h)
        if (persist) setSaved(true)
      } catch (e) {
        setHealthInfo(null)
        setConnectionError(
          t("options.brain.connection.error", {
            error: (e as Error).message ?? String(e),
          }),
        )
      } finally {
        setConnecting(false)
      }
    },
    [url, token, t],
  )

  /**
   * Kill the running gbrain server and respawn it, then re-run the test
   * so the user immediately sees whether the restart actually fixed
   * things. Used when a freshly-minted token keeps 401'ing — typically
   * means serve is holding a stale brain DB handle after a recovery /
   * migration on disk.
   */
  const restart = useCallback(async () => {
    setRestarting(true)
    setRestarted(false)
    setConnectionError(null)
    setSaved(false)
    try {
      const r = await restartGBrain()
      if (r && !r.ok) {
        setConnectionError(
          t("options.brainConfig.restart.failed", {
            error: r.error ?? "unknown error",
          }),
        )
        return
      }
      setRestarted(true)
    } finally {
      setRestarting(false)
    }
    // Auto re-test so the user doesn't have to click twice. Do this
    // outside the finally so a failed restart skips it.
    await testConnection({ persist: false })
  }, [t, testConnection])

  const connected = !!healthInfo

  // Render --------------------------------------------------------------------
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SettingsPaneHeader
        title={t("options.brainConfig.title")}
        subtitle={t("options.brainConfig.subtitle")}
      >
        {bootLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : connected ? (
          <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--success))]">
            <Check className="h-3 w-3" />
            {t("options.brain.connected")}
            {healthInfo?.version && (
              <span className="text-muted-foreground">
                v{healthInfo.version}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("options.brainConfig.notConnected")}
          </span>
        )}
      </SettingsPaneHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-6">
          {/* ── Connection ── */}
          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium">
              {t("options.brain.connection.title")}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="brain-config-url" className="text-xs">
                  {t("options.brain.connection.url")}
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
                  {t("options.brain.connection.token")}
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
                  placeholder={t(
                    "options.brain.connection.token.placeholder",
                  )}
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
                  ? t("options.brainConfig.saveAndTest")
                  : t("options.brain.connection.test")}
              </Button>
              {canRestart && (
                <Button
                  variant="outline"
                  onClick={() => void restart()}
                  disabled={restarting || connecting || bootLoading}
                  title={t("options.brainConfig.restart.hint")}
                  size="sm"
                >
                  {restarting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {restarting
                    ? t("options.brainConfig.restarting")
                    : t("options.brainConfig.restart")}
                </Button>
              )}
              {starting && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("options.brain.connection.starting")}
                </span>
              )}
              {!starting && connectionError && (
                <span className="text-xs text-destructive">
                  {connectionError}
                </span>
              )}
              {!starting && saved && !connectionError && (
                <span className="text-xs text-[hsl(var(--success))]">
                  {t("options.brainConfig.saved")}
                </span>
              )}
              {!starting && restarted && !connectionError && !saved && (
                <span className="text-xs text-[hsl(var(--success))]">
                  {t("options.brainConfig.restarted")}
                </span>
              )}
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("options.brainConfig.hint")}
            </p>
          </section>

          {/* ── Runtime info ── */}
          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium">
              {t("options.brainConfig.runtime.title")}
            </h3>
            {connected ? (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                <InfoRow
                  label={t("options.brainConfig.runtime.version")}
                  value={healthInfo?.version}
                />
                <InfoRow
                  label={t("options.brainConfig.runtime.engine")}
                  value={healthInfo?.engine}
                />
                <InfoRow
                  label={t("options.brainConfig.runtime.transport")}
                  value={healthInfo?.transport}
                />
                <InfoRow
                  label={t("options.brainConfig.runtime.db")}
                  value={healthInfo?.db}
                />
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("options.brainConfig.runtime.empty")}
              </p>
            )}
          </section>

          {/* ── Providers (display-only) ──
              All provider keys flow through env vars (or `gbrain config
              set …` for DB plane) — gbrain reads those uniformly across
              every recipe. We show the list and the env var name so
              users know exactly what to set in their shell or launcher
              before starting `gbrain serve --http`. */}
          {hasProvidersBridge && (
            <section className="space-y-3 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">
                    {t("options.brainConfig.config.section.providers")}
                  </h3>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {t("options.brainConfig.providers.envHint")}
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
                  {t("options.brainConfig.providers.refresh")}
                </Button>
              </div>

              {providersLoading && providers.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("options.brainConfig.providers.loading")}
                </div>
              ) : providersError ? (
                <p className="text-xs text-destructive">{providersError}</p>
              ) : providers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("options.brainConfig.providers.empty")}
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
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoRow({
  label,
  value,
}: {
  label: string
  value: string | undefined
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-mono text-[11px]">
        {value || "—"}
      </dd>
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
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [schema, setSchema] = useState<{
    required: string[]
    optional: string[]
    setupUrl?: string
  } | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  // Lazy-load the schema the first time the card opens. We deliberately
  // do NOT pre-fetch on mount — listing 18 providers would mean 18
  // subprocess spawns at panel-render time.
  useEffect(() => {
    if (!open || schema || schemaLoading) return
    const bridge = gbrainBridge()?.providers
    if (!bridge) return
    setSchemaLoading(true)
    setSchemaError(null)
    void bridge
      .env(provider.id)
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
            ? t("options.brainConfig.providers.collapse")
            : t("options.brainConfig.providers.expand")}
        </Button>
      </div>

      {open && (
        <div className="mt-2 border-t border-border/30 pt-2">
          {schemaLoading && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("options.brainConfig.providers.loading")}
            </div>
          )}
          {schemaError && (
            <p className="text-[11px] text-destructive">{schemaError}</p>
          )}
          {schema && (
            <div className="space-y-3">
              {schema.required.length > 0 && (
                <FieldGroup
                  title={t("options.brainConfig.providers.required")}
                  keys={schema.required}
                  providerId={provider.id}
                  savedKeys={savedKeys}
                  onChanged={onChanged}
                />
              )}
              {schema.optional.length > 0 && (
                <FieldGroup
                  title={t("options.brainConfig.providers.optional")}
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
                  {t("options.brainConfig.providers.setupLink")}
                </a>
              )}
            </div>
          )}
        </div>
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
  const { t } = useT()
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(async () => {
    const bridge = gbrainBridge()?.providers?.overrides
    if (!bridge || value.length === 0) return
    setBusy(true)
    setError(null)
    setJustSaved(false)
    try {
      const r = await bridge.set(providerId, envKey, value)
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
    const bridge = gbrainBridge()?.providers?.overrides
    if (!bridge) return
    setBusy(true)
    setError(null)
    setJustSaved(false)
    try {
      const r = await bridge.unset(providerId, envKey)
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
        <Label className="w-44 shrink-0 font-mono text-[10px]">{envKey}</Label>
        <Input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setJustSaved(false)
          }}
          placeholder={
            saved
              ? t("options.brainConfig.providers.placeholder.saved")
              : t("options.brainConfig.providers.placeholder.empty")
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
            t("options.brainConfig.providers.save")
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
            {t("options.brainConfig.providers.clear")}
          </Button>
        )}
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      {justSaved && !error && (
        <p className="text-[10px] text-[hsl(var(--success))]">
          {t("options.brainConfig.providers.saved")}
        </p>
      )}
    </div>
  )
}
