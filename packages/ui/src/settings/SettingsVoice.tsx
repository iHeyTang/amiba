import { CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import {
  downloadLocalModel,
  getSttConfig,
  getSttStatus,
  setSttConfig,
  setSttCredentials,
  transcribeAudio,
  useVoicePrefs,
  type SttConfig,
  type SttConfigResult,
  type SttProvider,
} from "@amiba/core"
import { useT, type MessageKey } from "@amiba/i18n"
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "../primitives"
import { cn } from "../primitives"
// Radix Select rejects "" as a value (it conflicts with "no selection"),
// so we route the "use whichever mic the OS picks" choice through a
// sentinel string and map back to "" when writing to prefs.
const SYSTEM_DEFAULT_DEVICE = "__system_default__"

const PROVIDER_ORDER: SttProvider[] = [
  "local",
  "groq",
  "openai",
  "mistral",
  "elevenlabs",
]

const LOCAL_MODEL_SIZES = [
  "tiny",
  "base",
  "small",
  "medium",
  "large-v3",
  "turbo",
] as const

// On-disk footprint of each model's HF snapshot, rounded for display in
// the download hint. These are approximate — the actual blob sizes drift
// a few percent across faster-whisper releases — but accurate enough to
// help the user decide whether to pull medium/large on a tethered link.
const LOCAL_MODEL_SIZE_HINT: Record<(typeof LOCAL_MODEL_SIZES)[number], string> = {
  tiny: "75 MB",
  base: "145 MB",
  small: "465 MB",
  medium: "1.5 GB",
  "large-v3": "2.9 GB",
  turbo: "1.6 GB",
}

const PROVIDER_LABEL_KEY: Record<SttProvider, MessageKey> = {
  local: "options.voice.provider.local",
  groq: "options.voice.provider.groq",
  openai: "options.voice.provider.openai",
  mistral: "options.voice.provider.mistral",
  elevenlabs: "options.voice.provider.elevenlabs",
}

type TestState =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "loading-model" }
  | { kind: "transcribing" }
  | { kind: "success"; text: string }
  | { kind: "empty" }
  | { kind: "error"; message: string }

interface MicDevice {
  deviceId: string
  label: string
}

export function SettingsVoice() {
  const { t } = useT()
  const prefs = useVoicePrefs()
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [test, setTest] = useState<TestState>({ kind: "idle" })
  const [config, setConfig] = useState<SttConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configBusy, setConfigBusy] = useState(false)
  // ``localModelCached`` decides whether the test transition shows the
  // generic "transcribing" copy or the longer "first-run download" hint,
  // and bumps the request timeout. Defaults to true so an unreachable
  // backplane doesn't spuriously flag the model as missing.
  const [localModelCached, setLocalModelCached] = useState(true)
  const [localModelsCached, setLocalModelsCached] = useState<
    Record<string, boolean>
  >({})
  // Download state is keyed by model name so retries for one size don't
  // wipe out the spinner for another concurrent download.
  type DownloadState =
    | { kind: "idle" }
    | { kind: "downloading" }
    | { kind: "error"; message: string }
  const [downloadStates, setDownloadStates] = useState<
    Record<string, DownloadState>
  >({})

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)

  const applyResult = useCallback((r: SttConfigResult) => {
    if (r.ok) {
      const { ok: _ok, ...rest } = r
      void _ok
      setConfig(rest)
      setConfigError(null)
    } else if ("error" in r) {
      // ``in`` narrows reliably under the extension's non-strict tsconfig.
      setConfigError(r.error)
    }
  }, [])

  const refreshConfig = useCallback(async () => {
    applyResult(await getSttConfig())
  }, [applyResult])

  const refreshStatus = useCallback(async () => {
    const r = await getSttStatus()
    if (r.ok) {
      setLocalModelCached(r.localModelCached)
      setLocalModelsCached(r.localModelsCached)
    }
  }, [])

  const startDownload = useCallback(
    async (model: string) => {
      setDownloadStates((s) => ({ ...s, [model]: { kind: "downloading" } }))
      const r = await downloadLocalModel(model)
      if (r.ok) {
        setDownloadStates((s) => ({ ...s, [model]: { kind: "idle" } }))
        // Optimistically flip the cache flag so the UI updates before the
        // status refresh round-trips. ``refreshStatus`` will overwrite
        // either way, so the optimism is just to avoid a UI flicker.
        setLocalModelsCached((m) => ({ ...m, [model]: true }))
        void refreshStatus()
      } else if ("error" in r) {
        setDownloadStates((s) => ({
          ...s,
          [model]: { kind: "error", message: r.error },
        }))
      }
    },
    [refreshStatus],
  )

  const patchConfig = useCallback(
    async (patch: Parameters<typeof setSttConfig>[0]) => {
      setConfigBusy(true)
      try {
        applyResult(await setSttConfig(patch))
      } finally {
        setConfigBusy(false)
      }
    },
    [applyResult],
  )

  const writeCredential = useCallback(
    async (
      provider: Exclude<SttProvider, "local">,
      envVar: string,
      value: string,
    ) => {
      setConfigBusy(true)
      try {
        applyResult(await setSttCredentials(provider, { [envVar]: value }))
      } finally {
        setConfigBusy(false)
      }
    },
    [applyResult],
  )

  useEffect(() => {
    void refreshConfig()
    void refreshStatus()
  }, [refreshConfig, refreshStatus])

  const refreshDevices = useCallback(async () => {
    try {
      const probe = await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .catch(() => null)
      const list = await navigator.mediaDevices.enumerateDevices()
      if (probe) for (const track of probe.getTracks()) track.stop()
      const audio = list
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || d.deviceId.slice(0, 8),
        }))
      setDevices(audio)
    } catch {
      setDevices([])
    }
  }, [])

  useEffect(() => {
    if (prefs.enabled) void refreshDevices()
  }, [prefs.enabled, refreshDevices])

  const teardownTest = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    recorderRef.current = null
    if (stream) for (const track of stream.getTracks()) track.stop()
  }, [])

  const runTest = useCallback(async () => {
    setTest({ kind: "recording" })
    try {
      // On Electron + macOS, ``getUserMedia`` reports a bare
      // ``Permission denied`` when the OS hasn't been asked yet or when
      // the user previously denied access in System Settings. Route
      // through the main process first so the native dialog fires on
      // the first attempt and we can surface a more actionable error
      // when access is explicitly denied. ``window.hermes`` is absent
      // in the browser-extension build, so we feature-detect.
      const ensure = (window as unknown as {
        hermes?: {
          voice?: {
            ensureMicrophoneAccess: () => Promise<
              "granted" | "denied" | "restricted" | "not-determined" | "unknown"
            >
          }
        }
      }).hermes?.voice?.ensureMicrophoneAccess
      if (ensure) {
        const status = await ensure()
        if (status === "denied" || status === "restricted") {
          setTest({
            kind: "error",
            message: t("composer.voice.permissionDenied"),
          })
          return
        }
        // "granted" / "unknown" / "not-determined" fall through —
        // getUserMedia is still the authoritative gate.
      }
      const constraints: MediaStreamConstraints = {
        audio: prefs.deviceId ? { deviceId: { exact: prefs.deviceId } } : true,
        video: false,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data)
      }
      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }))
        }
      })
      recorder.start()
      await new Promise((r) => setTimeout(r, 2000))
      recorder.stop()
      const blob = await done
      teardownTest()

      // When the local model hasn't been cached yet, the first call
      // downloads ~150 MB inline — surface that explicitly so users
      // don't think the test is stuck, and stretch the timeout to
      // five minutes to cover the download itself.
      const needsDownload =
        (config?.provider ?? "local") === "local" && !localModelCached
      setTest({ kind: needsDownload ? "loading-model" : "transcribing" })
      const result = await transcribeAudio(blob, {
        timeoutMs: needsDownload ? 5 * 60_000 : 60_000,
      })
      if (result.ok !== true) {
        // ``in`` narrows the error variant under the extension's
        // non-strict tsconfig (discriminated-union narrowing is flaky
        // there). ``kind`` is optional on SttError so check before read.
        const errResult = "error" in result ? result : null
        const message =
          errResult && "kind" in errResult && errResult.kind === "timeout"
            ? t("options.voice.test.timeout")
            : (errResult?.error ?? "unknown")
        setTest({ kind: "error", message })
        return
      }
      // First successful run finishes the download — refresh the cached
      // flag so subsequent tests skip the "loading model" hint.
      if (needsDownload) void refreshStatus()
      const text = result.text.trim()
      setTest(text ? { kind: "success", text } : { kind: "empty" })
    } catch (e) {
      teardownTest()
      // ``getUserMedia`` rejects with ``NotAllowedError`` when the OS
      // (or a previously installed permission handler) blocks mic
      // access. The browser's default message is the unhelpful
      // ``Permission denied`` — replace it with the localised hint that
      // tells the user where to flip the toggle.
      const err = e as DOMException | Error
      const isDenied =
        (err as DOMException).name === "NotAllowedError" ||
        (err as DOMException).name === "SecurityError" ||
        /permission denied|not allowed/i.test(err?.message ?? "")
      setTest({
        kind: "error",
        message: isDenied
          ? t("composer.voice.permissionDenied")
          : String(err?.message || err),
      })
    }
  }, [
    config?.provider,
    localModelCached,
    prefs.deviceId,
    refreshStatus,
    t,
    teardownTest,
  ])

  useEffect(() => () => teardownTest(), [teardownTest])

  const provider = config?.provider ?? "local"
  const localModel = config?.providers.local.model ?? "base"

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <Section>
        <SwitchRow
          id="voice-enabled"
          label={t("options.voice.enable.label")}
          hint={t("options.voice.enable.help")}
          checked={prefs.enabled}
          onChange={(next) => void prefs.update({ enabled: next })}
        />
        <SwitchRow
          id="voice-autosend"
          label={t("options.voice.autoSend.label")}
          hint={t("options.voice.autoSend.help")}
          checked={prefs.autoSend}
          disabled={!prefs.enabled}
          onChange={(next) => void prefs.update({ autoSend: next })}
        />
      </Section>

      <Section title={t("options.voice.provider.label")}>
        {configError ? (
          <ErrorBanner message={configError} onRetry={() => void refreshConfig()} />
        ) : config == null ? (
          <p className="text-[11px] text-muted-foreground">
            {t("options.voice.status.loading")}
          </p>
        ) : (
          <>
            <SegmentedRow
              ariaLabel={t("options.voice.provider.label")}
              label={t("options.voice.provider.label")}
              value={provider}
              disabled={configBusy}
              options={PROVIDER_ORDER.map((v) => ({
                value: v,
                label: t(PROVIDER_LABEL_KEY[v]),
              }))}
              onChange={(v) => void patchConfig({ provider: v })}
            />
            {provider === "local" ? (
              <div className="space-y-2">
                <SegmentedRow
                  ariaLabel={t("options.voice.localModel.label")}
                  label={t("options.voice.localModel.label")}
                  hint={t("options.voice.localModel.help")}
                  value={
                    (LOCAL_MODEL_SIZES as readonly string[]).includes(
                      localModel,
                    )
                      ? localModel
                      : "base"
                  }
                  disabled={configBusy}
                  options={LOCAL_MODEL_SIZES.map((v) => ({
                    value: v,
                    label: v,
                  }))}
                  onChange={(v) =>
                    void patchConfig({
                      providers: { local: { model: v } },
                    })
                  }
                />
                <LocalModelStatus
                  model={
                    (LOCAL_MODEL_SIZES as readonly string[]).includes(
                      localModel,
                    )
                      ? (localModel as (typeof LOCAL_MODEL_SIZES)[number])
                      : "base"
                  }
                  cached={
                    localModelsCached[
                      (LOCAL_MODEL_SIZES as readonly string[]).includes(
                        localModel,
                      )
                        ? localModel
                        : "base"
                    ] ?? false
                  }
                  state={
                    downloadStates[
                      (LOCAL_MODEL_SIZES as readonly string[]).includes(
                        localModel,
                      )
                        ? localModel
                        : "base"
                    ] ?? { kind: "idle" }
                  }
                  onDownload={(m) => void startDownload(m)}
                />
              </div>
            ) : (
              <CredentialEditor
                provider={provider}
                state={config.credentials[provider]}
                disabled={configBusy}
                onSave={(value) =>
                  void writeCredential(
                    provider,
                    config.credentials[provider].env_var,
                    value,
                  )
                }
              />
            )}
          </>
        )}
      </Section>

      <Section title={t("options.voice.device.label")}>
        <div className="flex items-center gap-2">
          <Select
            value={prefs.deviceId || SYSTEM_DEFAULT_DEVICE}
            disabled={!prefs.enabled}
            onValueChange={(v) =>
              void prefs.update({
                deviceId: v === SYSTEM_DEFAULT_DEVICE ? "" : v,
              })
            }
          >
            <SelectTrigger
              aria-label={t("options.voice.device.label")}
              className="flex-1"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SYSTEM_DEFAULT_DEVICE}>
                {t("options.voice.device.system")}
              </SelectItem>
              {devices.map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0"
            disabled={!prefs.enabled}
            onClick={() => void refreshDevices()}
            title={t("options.voice.device.refresh")}
            aria-label={t("options.voice.device.refresh")}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </Section>

      <Section title={t("options.voice.test.label")}>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={
              !prefs.enabled ||
              test.kind === "recording" ||
              test.kind === "transcribing" ||
              test.kind === "loading-model"
            }
            onClick={() => void runTest()}
          >
            {test.kind === "recording"
              ? t("options.voice.test.recording")
              : test.kind === "loading-model"
                ? t("options.voice.test.loadingModel")
                : test.kind === "transcribing"
                  ? t("options.voice.test.transcribing")
                  : t("options.voice.test.start")}
          </Button>
          <TestStatus state={test} />
        </div>
      </Section>
    </div>
  )
}

/* ---------- local-model download status -------------------------------- */

type LocalModelName = (typeof LOCAL_MODEL_SIZES)[number]
type DownloadStateView =
  | { kind: "idle" }
  | { kind: "downloading" }
  | { kind: "error"; message: string }

function LocalModelStatus({
  model,
  cached,
  state,
  onDownload,
}: {
  model: LocalModelName
  cached: boolean
  state: DownloadStateView
  onDownload: (model: LocalModelName) => void
}) {
  const { t } = useT()
  const sizeHint = LOCAL_MODEL_SIZE_HINT[model]

  if (state.kind === "downloading") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="flex-1">
          {t("options.voice.localModel.downloading", { model })}
        </span>
      </div>
    )
  }

  if (state.kind === "error") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
        <span className="flex-1">
          {t("options.voice.localModel.downloadFailed", {
            error: state.message,
          })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => onDownload(model)}
        >
          {t("options.voice.localModel.retry")}
        </Button>
      </div>
    )
  }

  if (!cached) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <Download className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">
          {t("options.voice.localModel.notDownloaded", {
            model,
            size: sizeHint,
          })}
        </span>
        <Button
          type="button"
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => onDownload(model)}
        >
          {t("options.voice.localModel.download")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
      <span>{t("options.voice.localModel.ready", { model })}</span>
    </div>
  )
}

/* ---------- credential editor (per cloud provider) -------------------- */

function CredentialEditor({
  provider,
  state,
  disabled,
  onSave,
}: {
  provider: Exclude<SttProvider, "local">
  state: { has_key: boolean; env_var: string }
  disabled: boolean
  onSave: (value: string) => void
}) {
  const { t } = useT()
  const [draft, setDraft] = useState("")
  const [confirmClear, setConfirmClear] = useState(false)

  // When the user switches provider, the saved-key state changes —
  // clear any partially-typed draft so we don't carry a value from
  // one provider's input into another's.
  useEffect(() => {
    setDraft("")
    setConfirmClear(false)
  }, [provider, state.env_var])

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="flex items-baseline justify-between">
        <Label className="text-[11px] font-semibold uppercase tracking-wider">
          {t("options.voice.apiKey.label")} ({state.env_var})
        </Label>
        <span
          className={cn(
            "text-[11px]",
            state.has_key ? "text-emerald-600" : "text-muted-foreground/80",
          )}
        >
          {state.has_key
            ? t("options.voice.apiKey.set")
            : t("options.voice.apiKey.unset")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            state.has_key
              ? t("options.voice.apiKey.placeholderReplace")
              : t("options.voice.apiKey.placeholder")
          }
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1"
        />
        <Button
          type="button"
          size="sm"
          disabled={disabled || draft.trim().length === 0}
          onClick={() => {
            onSave(draft.trim())
            setDraft("")
          }}
        >
          {t("common.save")}
        </Button>
        {state.has_key ? (
          confirmClear ? (
            <>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  onSave("")
                  setConfirmClear(false)
                }}
              >
                {t("options.voice.apiKey.confirmClear")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmClear(false)}
              >
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setConfirmClear(true)}
            >
              {t("options.voice.apiKey.clear")}
            </Button>
          )
        ) : null}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {t("options.voice.apiKey.help")}
      </p>
    </div>
  )
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const { t } = useT()
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-[11px] text-destructive">
        {t("options.voice.status.error", { error: message })}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t("options.voice.status.retry")}
      </Button>
    </div>
  )
}

function TestStatus({ state }: { state: TestState }) {
  const { t } = useT()
  if (state.kind === "idle") return null
  if (state.kind === "recording")
    return (
      <span className="text-[11px] text-muted-foreground">
        {t("options.voice.test.recording")}
      </span>
    )
  if (state.kind === "loading-model")
    return (
      <span className="text-[11px] text-muted-foreground">
        {t("options.voice.test.loadingModel")}
      </span>
    )
  if (state.kind === "transcribing")
    return (
      <span className="text-[11px] text-muted-foreground">
        {t("options.voice.test.transcribing")}
      </span>
    )
  if (state.kind === "empty")
    return (
      <span className="text-[11px] text-muted-foreground">
        {t("options.voice.test.empty")}
      </span>
    )
  if (state.kind === "error")
    return (
      <span className="text-[11px] text-destructive">
        {t("options.voice.test.failed", { error: state.message })}
      </span>
    )
  return (
    <span className="text-[11px] text-foreground">
      {t("options.voice.test.success", { text: state.text })}
    </span>
  )
}

/* ---------- shared layout primitives ----------------------------------- */

function Section({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      {title ? (
        <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
        </div>
      ) : null}
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0 flex-1">
        <Label
          htmlFor={id}
          className={cn(
            "text-sm font-normal",
            disabled && "text-muted-foreground/60",
          )}
        >
          {label}
        </Label>
        {hint && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  )
}

function SegmentedRow<T extends string>({
  ariaLabel,
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
}: {
  ariaLabel: string
  label?: string
  hint?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5 py-1">
      {label && (
        <div className="flex items-baseline justify-between gap-3">
          <Label className="text-sm font-normal">{label}</Label>
          {hint && (
            <p className="text-[11px] text-muted-foreground/80">{hint}</p>
          )}
        </div>
      )}
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={cn(
          // p-1 + inner h-8 buttons = total h-10, matching SelectTrigger
          // and Input on the same page so the controls visually line up.
          "inline-flex flex-wrap gap-1 rounded-md bg-muted/40 p-1",
          disabled && "opacity-50",
        )}
      >
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={cn(
                "inline-flex h-8 items-center rounded px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed",
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
