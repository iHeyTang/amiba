/**
 * First-run setup wizard for the desktop app.
 *
 * Three phases hang off the same React tree:
 *
 *   - `detecting`: we're probing the binary, the plugin dirs, and the
 *     gateway health endpoint. Centered spinner; no stepper yet (we
 *     don't know what state to show on it).
 *   - `summary`: detection finished but something is missing. Stepper
 *     shows which milestones are done vs pending. The user hits the
 *     primary CTA to run the auto-install pipeline, or expands the
 *     "do it myself" disclosure to grab the manual install command.
 *   - `running`: pipeline is in flight. The stepper's current node
 *     spins, and the rest of the screen is a live terminal — either an
 *     xterm.js PTY (interactive Hermes install + `hermes setup`
 *     wizard) or a simpler line-based log panel (plugins, gateway).
 *
 *  When everything's already in place — or we just finished — phase
 *  flips to `ready` and we hand off to the host app after a short beat
 *  so the success state is visible.
 *
 *  The wizard's chrome reserves the macOS traffic-light area and is a
 *  drag region so the OS lights don't visually crash into the title.
 */
import { getHermesStatus } from "@hermes-x/core"
import { useT, type MessageKey, type TranslateFn } from "@hermes-x/i18n"
import { useDocumentTheme } from "@hermes-x/theme"
import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Copy, Loader2, RefreshCw, Sparkles } from "lucide-react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"

import { HermesLogo } from "@hermes-x/ui"

const MAX_LOG_LINES = 600
const BACKPLANE_POLL_INTERVAL_MS = 1200
const BACKPLANE_POLL_TIMEOUT_MS = 60_000
// macOS keeps the traffic-light cluster at (20, 14) (see main/index.ts).
// We reserve a draggable strip at the top of the window that's exactly
// as tall as that cluster instead of overlapping it with welcome text —
// the previous "header next to the dots" layout looked wedged.
const MAC_TITLE_BAR_RESERVE = 32
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

type Phase = "detecting" | "summary" | "running" | "ready"

type DetectionItemKey = "hermes" | "backplane" | `plugin:${string}`

interface Detection {
  hermes: { installed: boolean; binary?: string; version?: string }
  plugins: { id: string; installed: boolean }[]
  backplane: { running: boolean }
}

interface ActiveAction {
  itemKey: DetectionItemKey
}

interface LogLine {
  stream: "stdout" | "stderr"
  line: string
  ts: number
}

// --- Stepper model -------------------------------------------------------

type StepKey = "install" | "plugins" | "backplane" | "ready"
type StepState = "pending" | "running" | "done" | "error"

const STEP_ORDER: StepKey[] = ["install", "plugins", "backplane", "ready"]

const STEP_LABEL_KEY: Record<StepKey, MessageKey> = {
  install: "onboarding.step.install",
  plugins: "onboarding.step.plugins",
  backplane: "onboarding.step.backplane",
  ready: "onboarding.step.ready",
}

function activeStepKey(active: DetectionItemKey | null): StepKey | null {
  if (!active) return null
  if (active === "hermes") return "install"
  if (active === "backplane") return "backplane"
  return "plugins" // plugin:<id>
}

interface StepNode {
  key: StepKey
  label: string
  state: StepState
}

function buildSteps(
  d: Detection | null,
  active: DetectionItemKey | null,
  phase: Phase,
  errored: boolean,
  t: TranslateFn,
): StepNode[] {
  const installed = !!d?.hermes.installed
  const allPluginsIn = !!d?.plugins.every((p) => p.installed)
  const backplaneUp = !!d?.backplane.running
  const allReady = installed && allPluginsIn && backplaneUp
  const activeKey = activeStepKey(active)

  function stateFor(key: StepKey): StepState {
    if (key === "ready") return allReady ? "done" : "pending"
    const done =
      (key === "install" && installed) ||
      (key === "plugins" && allPluginsIn) ||
      (key === "backplane" && backplaneUp)
    if (done) return "done"
    if (phase === "running" && activeKey === key) {
      return errored ? "error" : "running"
    }
    return "pending"
  }

  return STEP_ORDER.map((key) => ({
    key,
    label: t(STEP_LABEL_KEY[key]),
    state: stateFor(key),
  }))
}

// --- Component -----------------------------------------------------------

export function OnboardingWizard({ onReady }: { onReady: () => void }) {
  const { t } = useT()
  const rt = window.hermes.hermesRuntime

  const [phase, setPhase] = useState<Phase>("detecting")
  const [detection, setDetection] = useState<Detection | null>(null)
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [installCommand, setInstallCommand] = useState("")
  /**
   * Index (within the rendered manual-command list) of the row whose
   * copy button was most recently clicked, or null if no row is
   * currently in its "已复制" pulse. Stored as an index rather than a
   * boolean so multiple commands can each show their own feedback.
   */
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  /**
   * Non-null while a PTY-backed job (the interactive install + setup
   * wizard) is running. Drives whether the running phase renders the
   * xterm.js terminal or the simpler line-based log panel.
   */
  const [ptyJobId, setPtyJobId] = useState<string | null>(null)

  const activeJobIdRef = useRef<string | null>(null)
  // The pipeline driver awaits job-end via this resolver — the IPC
  // subscription below fans the message back to whichever pipeline step
  // is currently in flight.
  const pendingResolveRef = useRef<
    ((m: { exitCode: number | null; error?: string }) => void) | null
  >(null)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  // --- subscribe once to spawn output --------------------------------------
  useEffect(() => {
    const offLog = rt.onJobLog((msg) => {
      if (msg.jobId !== activeJobIdRef.current) return
      appendLog({ stream: msg.stream, line: msg.line, ts: Date.now() })
    })
    const offEnd = rt.onJobEnd((msg) => {
      if (msg.jobId !== activeJobIdRef.current) return
      const resolve = pendingResolveRef.current
      pendingResolveRef.current = null
      activeJobIdRef.current = null
      if (resolve) resolve({ exitCode: msg.exitCode, error: msg.error })
    })
    return () => {
      offLog()
      offEnd()
    }
  }, [rt])

  // --- preload install command + run initial detect ------------------------
  useEffect(() => {
    void rt.installDisplayCommand().then(setInstallCommand)
    void runDetect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function appendLog(line: LogLine) {
    setLogs((prev) => {
      const next =
        prev.length >= MAX_LOG_LINES ? prev.slice(prev.length - MAX_LOG_LINES + 1) : prev
      return [...next, line]
    })
  }
  function clearLogs() {
    setLogs([])
  }

  async function runDetect() {
    setPhase("detecting")
    setError(null)
    setActiveAction(null)
    clearLogs()

    const status = await getHermesStatus()
    const hermesDet = await rt.detect()
    const required = await rt.requiredPlugins()
    const installedList = await rt.installedPlugins()
    const installedSet = new Set(installedList)

    const det: Detection = {
      hermes: hermesDet,
      plugins: required.map((id) => ({ id, installed: installedSet.has(id) })),
      backplane: { running: status.ok },
    }
    setDetection(det)

    if (isAllReady(det)) {
      setPhase("ready")
      window.setTimeout(() => onReadyRef.current(), 500)
      return
    }
    setPhase("summary")
  }

  // --- pipeline ------------------------------------------------------------
  async function runJob(
    itemKey: DetectionItemKey,
    startFn: () => Promise<{ id: string }>,
  ): Promise<{ exitCode: number | null; error?: string }> {
    setActiveAction({ itemKey })
    clearLogs()
    return new Promise((resolve) => {
      pendingResolveRef.current = resolve
      void startFn().then(({ id }) => {
        activeJobIdRef.current = id
      })
    })
  }

  async function runPipeline() {
    if (!detection) return
    setPhase("running")
    setError(null)

    let det = detection

    // 1. Install Hermes binary under a PTY so the embedded `hermes setup`
    //    wizard sees a real terminal — the line-based pipe path causes the
    //    wizard to auto-skip on `(: </dev/tty)`, leaving the user with no
    //    API keys configured. Renderer keystrokes round-trip through
    //    `rt.ptyInput` while output streams via `onPtyData`.
    if (!det.hermes.installed) {
      setActiveAction({ itemKey: "hermes" })
      clearLogs()
      const r = await new Promise<{ exitCode: number | null; error?: string }>(
        (resolve) => {
          pendingResolveRef.current = resolve
          void rt.installPty().then(({ id }) => {
            activeJobIdRef.current = id
            setPtyJobId(id)
          })
        },
      )
      setPtyJobId(null)
      if (r.exitCode !== 0) {
        setError(formatJobError(r, t("onboarding.error.install")))
        setPhase("summary")
        return
      }
      const redet = await rt.detect()
      if (!redet.installed || !redet.binary) {
        setError(t("onboarding.error.install"))
        setPhase("summary")
        return
      }
      det = { ...det, hermes: redet }
      setDetection(det)
    }

    const binary = det.hermes.binary
    if (!binary) {
      setError(t("onboarding.error.install"))
      setPhase("summary")
      return
    }

    // 2. Install missing plugins.
    for (let i = 0; i < det.plugins.length; i++) {
      const p = det.plugins[i]
      if (p.installed) continue
      const r = await runJob(`plugin:${p.id}`, () =>
        rt.installPlugin({ binary, pluginId: p.id }),
      )
      if (r.exitCode !== 0) {
        setError(formatJobError(r, t("onboarding.error.plugin")))
        setPhase("summary")
        return
      }
      const nextPlugins = det.plugins.slice()
      nextPlugins[i] = { ...p, installed: true }
      det = { ...det, plugins: nextPlugins }
      setDetection(det)
    }

    // 3. Start the gateway and wait for the HTTP probe.
    if (!det.backplane.running) {
      setActiveAction({ itemKey: "backplane" })
      clearLogs()
      const start = await rt.startBackplane({ binary })
      activeJobIdRef.current = start.id
      const up = await pollBackplane()
      if (!up) {
        setError(t("onboarding.error.backplane"))
        setPhase("summary")
        return
      }
      det = { ...det, backplane: { running: true } }
      setDetection(det)
    }

    setActiveAction(null)
    setPhase("ready")
    window.setTimeout(() => onReadyRef.current(), 700)
  }

  function pollBackplane(): Promise<boolean> {
    const deadline = Date.now() + BACKPLANE_POLL_TIMEOUT_MS
    return new Promise((resolve) => {
      const tick = async () => {
        const s = await getHermesStatus()
        if (s.ok) return resolve(true)
        if (Date.now() >= deadline) return resolve(false)
        window.setTimeout(tick, BACKPLANE_POLL_INTERVAL_MS)
      }
      void tick()
    })
  }

  async function copyManualCommand(index: number, command: string) {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedIndex(index)
      window.setTimeout(() => setCopiedIndex(null), 1500)
    } catch {
      // best effort
    }
  }

  // Stepper is exclusive to the running phase — before the user has
  // committed to installing, an all-pending stepper would just be visual
  // noise competing with the hero for attention.
  const steps =
    phase === "running"
      ? buildSteps(detection, activeAction?.itemKey ?? null, phase, !!error, t)
      : null

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Soft ambient gradient backdrop — see SummaryBlock for why this
          is louder during summary (when hero owns the screen) and
          quieter during running (when terminal needs to read clean). */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute left-1/2 top-[8%] h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-blue-300/40 blur-[120px] dark:bg-blue-500/15" />
        <div className="absolute right-[8%] top-[55%] h-[320px] w-[320px] rounded-full bg-sky-300/25 blur-[110px] dark:bg-sky-500/10" />
      </div>

      <div
        className="app-drag-region relative z-10 shrink-0"
        style={{ height: IS_MAC ? MAC_TITLE_BAR_RESERVE : 0 }}
      />

      {/* Two distinct screens routed by phase:
          - summary: hero + CTA + manual install (block 1, pre-action)
          - running: stepper + caption + terminal (block 2, in-progress)
          Detecting and ready are short-lived bookends without either. */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-8 pb-6 pt-4">
        {phase === "detecting" && <DetectingState t={t} />}

        {phase === "summary" && detection && (
          <SummaryBlock
            detection={detection}
            error={error}
            installCommand={installCommand}
            copiedIndex={copiedIndex}
            onInstall={() => void runPipeline()}
            onRedetect={() => void runDetect()}
            onCopy={(i, cmd) => void copyManualCommand(i, cmd)}
            t={t}
          />
        )}

        {phase === "running" && steps && (
          <RunningBlock
            steps={steps}
            activeStep={activeStepKey(activeAction?.itemKey ?? null)}
            ptyJobId={ptyJobId}
            logs={logs}
            t={t}
          />
        )}

        {phase === "ready" && <ReadyState t={t} />}
      </main>
    </div>
  )
}

function isAllReady(d: Detection): boolean {
  return (
    d.hermes.installed &&
    d.plugins.every((p) => p.installed) &&
    d.backplane.running
  )
}

function formatJobError(
  r: { exitCode: number | null; error?: string },
  fallback: string,
): string {
  if (r.error) return `${fallback} — ${r.error}`
  if (r.exitCode !== null) return `${fallback} (exit ${r.exitCode})`
  return fallback
}

// --- Stepper -------------------------------------------------------------

/**
 * Horizontal stepper. Each node is a numbered/checked circle with a
 * label underneath; fixed-width connectors between them gain colour as
 * you progress so the eye can read the journey at a glance.
 *
 * Important layout note: the stepper is content-sized and centered
 * with `mx-auto`, NOT stretched to fill the column. An earlier version
 * used `flex-1` on each step which made the stepper span edge-to-edge
 * — that read like "the stepper lives in its own wider layer" relative
 * to the left-aligned welcome banner and headline above/below it.
 *
 * State colours intentionally reuse the wizard palette (emerald /
 * foreground / destructive) instead of bespoke step colours.
 */
function Stepper({ steps }: { steps: StepNode[] }) {
  return (
    <ol className="mx-auto flex shrink-0 items-start">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        const next = steps[i + 1]
        const connectorActive =
          step.state === "done" || (next && next.state !== "pending")
        return (
          <li key={step.key} className="flex items-start">
            <div className="flex w-20 flex-col items-center gap-1.5">
              <StepDot state={step.state} index={i + 1} />
              <span
                className={`whitespace-nowrap text-[11px] ${
                  step.state === "running"
                    ? "font-medium text-foreground"
                    : step.state === "done"
                      ? "text-foreground/85"
                      : step.state === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`mt-3 h-px w-16 ${
                  connectorActive ? "bg-foreground/40" : "bg-border"
                }`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function StepDot({ state, index }: { state: StepState; index: number }) {
  const base =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium transition-colors"
  if (state === "done") {
    return (
      <div
        className={`${base} bg-emerald-500/15 text-emerald-700 dark:text-emerald-300`}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </div>
    )
  }
  if (state === "running") {
    // Warm blue (Tailwind blue-500, rgb 59/130/246) is the wizard's one
    // brand-accent moment: it ties back to the backdrop's halo and signals
    // "this is where the action is right now" without dragging the rest
    // of the UI into colour. The faux outer ring is a box-shadow, not a
    // real element, so there's no layout shift between states.
    return (
      <div
        className={`${base} bg-blue-500 text-white shadow-[0_0_0_4px_rgba(59,130,246,0.22)] dark:bg-blue-500 dark:text-blue-50`}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    )
  }
  if (state === "error") {
    return (
      <div className={`${base} bg-destructive/15 text-destructive`}>{index}</div>
    )
  }
  return (
    <div
      className={`${base} border border-border bg-background text-muted-foreground`}
    >
      {index}
    </div>
  )
}

// --- Phase: detecting ----------------------------------------------------

function DetectingState({ t }: { t: TranslateFn }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{t("onboarding.detect.checking")}</p>
    </div>
  )
}

// --- Phase: summary ------------------------------------------------------

/**
 * Block 1 of the wizard — what the user sees before they click "开始准备".
 *
 *   - Hero (logo + title + subtitle) takes the screen as the focal block.
 *     The subtitle already describes what we'll do, so we don't repeat
 *     "还差几样就准备好了" — it was a duplicate signal that diluted the
 *     hero rather than adding info.
 *   - Primary CTA + secondary recheck button sit centered under the hero.
 *   - Manual install command stays pinned at the bottom of the window
 *     as a low-key fallback for people who want to drive the install
 *     from a terminal themselves.
 */
interface ManualCommand {
  label: string
  command: string
}

/**
 * Builds the user-facing list of commands the manual recipe needs to
 * cover. Only includes steps the user actually needs to run — once a
 * piece is detected as installed, its row drops out so the recipe
 * doesn't tell people to redo work.
 *
 * Step numbering renumbers around drop-outs (if Hermes is already
 * there but both plugins are missing, the plugins become "1" and "2"
 * rather than "2" and "3") — the numbering is just visual sequencing
 * for the user, not a stable mapping to anything else.
 */
function buildManualCommands(
  detection: Detection,
  installCommand: string,
  t: TranslateFn,
): ManualCommand[] {
  const out: ManualCommand[] = []
  if (!detection.hermes.installed) {
    out.push({
      label: t("onboarding.install.manualStep.install"),
      command: installCommand,
    })
  }
  for (const p of detection.plugins) {
    if (p.installed) continue
    out.push({
      label: t("onboarding.install.manualStep.plugin", {
        n: out.length + 1,
        id: p.id,
      }),
      command: `hermes plugins install ${p.id}`,
    })
  }
  return out
}

function SummaryBlock({
  detection,
  error,
  installCommand,
  copiedIndex,
  onInstall,
  onRedetect,
  onCopy,
  t,
}: {
  detection: Detection
  error: string | null
  installCommand: string
  copiedIndex: number | null
  onInstall: () => void
  onRedetect: () => void
  onCopy: (index: number, command: string) => void
  t: TranslateFn
}) {
  const manualCommands = buildManualCommands(detection, installCommand, t)
  return (
    /*
     * Native page-level scroll. The earlier "flex-1 justify-center"
     * inside an overflow-hidden parent broke when the manual install
     * disclosure expanded — the centered child shrank, clipped the CTA
     * buttons, and let the manual block visually overlap them. Going
     * back to `overflow-y-auto` on the column + `mt-auto` on the
     * manual block gives us:
     *
     *   - tall window  → mt-auto eats remaining space, manual sits at
     *     the bottom, hero+CTA breathe naturally near the top
     *   - short window → mt-auto collapses to 0, content stacks
     *     naturally, the page scrolls and nothing is ever clipped
     */
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col overflow-y-auto pb-6 pt-8">
      <header className="flex flex-col items-center gap-4 text-center">
        <HermesLogo size={64} />
        <div>
          <h1 className="text-2xl font-medium tracking-tight">
            {t("onboarding.title")}
          </h1>
          {/* Brand-voice tagline: what the product is + the one feature
              that makes the desktop version feel distinct (double-tap
              ⌘ to summon a chat). Two manually-broken lines via \n so
              the value prop and the call-to-action read as separate
              beats rather than one long sentence. */}
          <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-foreground/80">
            {t("onboarding.tagline")}
          </p>
          {/* Utility paragraph: what's about to happen. Muted +
              `whitespace-pre-line` so the i18n string controls its own
              break between "we'll do X" and "takes ~10 min". */}
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {t("onboarding.subtitle")}
          </p>
        </div>
      </header>

      {error && (
        <div className="mt-8 flex justify-center">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onInstall}
          className="app-no-drag inline-flex items-center gap-1.5 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background shadow-lg shadow-foreground/20 transition-all hover:-translate-y-px hover:bg-foreground/90 hover:shadow-xl hover:shadow-foreground/25 active:translate-y-0 active:shadow-md"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("onboarding.summary.action.install")}
        </button>
        <button
          type="button"
          onClick={onRedetect}
          className="app-no-drag inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-4 py-2.5 text-sm text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("onboarding.summary.action.recheck")}
        </button>
      </div>

      {manualCommands.length > 0 && (
        <div className="mt-auto pt-10">
          <ManualCommandBlock
            title={t("onboarding.install.manualTitle")}
            hint={t("onboarding.install.manualHint")}
            commands={manualCommands}
            copiedIndex={copiedIndex}
            onCopy={onCopy}
            t={t}
          />
        </div>
      )}
    </div>
  )
}

// --- Phase: running ------------------------------------------------------

/**
 * Block 2 of the wizard — what the user sees after clicking "开始准备".
 *
 *   - Stepper takes the top, showing the four install milestones with
 *     the current one highlighted in warm blue.
 *   - A short caption tells the user what's happening AND that some
 *     prompts (API keys etc.) require direct terminal input.
 *   - Terminal fills the rest of the available height, getting the
 *     full max-w-4xl band so the install output has room to breathe.
 *
 * No hero here on purpose: once the user commits to installing, the
 * "welcome" framing is over and progress + raw output should own the
 * screen.
 */
function RunningBlock({
  steps,
  activeStep,
  ptyJobId,
  logs,
  t,
}: {
  steps: StepNode[]
  activeStep: StepKey | null
  ptyJobId: string | null
  logs: LogLine[]
  t: TranslateFn
}) {
  const stepLabel = activeStep ? t(STEP_LABEL_KEY[activeStep]) : ""
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 overflow-hidden">
      <Stepper steps={steps} />
      {stepLabel && (
        <p className="shrink-0 text-center text-sm text-muted-foreground">
          {t("onboarding.running.caption", { step: stepLabel })}
        </p>
      )}
      {ptyJobId ? (
        <TerminalPanel jobId={ptyJobId} />
      ) : (
        <LogPanel logs={logs} t={t} />
      )}
    </div>
  )
}

// --- Phase: ready --------------------------------------------------------

function ReadyState({ t }: { t: TranslateFn }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
        <Check className="h-6 w-6" strokeWidth={2.5} />
      </div>
      <p className="text-base font-medium">{t("onboarding.ready.title")}</p>
      <p className="text-sm text-muted-foreground">{t("onboarding.ready.subtitle")}</p>
    </div>
  )
}

// --- Shared bits ---------------------------------------------------------

function ManualCommandBlock({
  title,
  hint,
  commands,
  copiedIndex,
  onCopy,
  t,
}: {
  title: string
  hint: string
  commands: ManualCommand[]
  copiedIndex: number | null
  onCopy: (index: number, command: string) => void
  t: TranslateFn
}) {
  return (
    <details className="app-no-drag rounded-md border border-border/40 bg-muted/20 p-3 text-xs">
      <summary className="cursor-pointer select-none font-medium text-foreground/85">
        {title}
      </summary>
      <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>
      <div className="mt-3 space-y-2.5">
        {commands.map((c, i) => (
          <div key={`${i}-${c.command}`}>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {c.label}
            </p>
            <div className="relative">
              <pre className="overflow-x-auto rounded bg-muted/60 p-3 pr-20 font-mono text-[11px] leading-relaxed">
                {c.command || "…"}
              </pre>
              <button
                type="button"
                onClick={() => onCopy(i, c.command)}
                className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-border/40 bg-background/80 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                {copiedIndex === i
                  ? t("onboarding.action.copied")
                  : t("onboarding.action.copy")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  )
}

function LogPanel({ logs, t }: { logs: LogLine[]; t: TranslateFn }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("onboarding.log.title")}
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          {logs.length} lines
        </span>
      </div>
      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-black/85 px-3 py-2 font-mono text-[11px] leading-snug text-zinc-200"
      >
        {logs.length === 0 ? (
          <p className="text-zinc-500">{t("onboarding.log.empty")}</p>
        ) : (
          logs.map((l, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap break-all ${
                l.stream === "stderr" ? "text-amber-300" : ""
              }`}
            >
              {l.line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/**
 * Light/dark colour pairs for the embedded xterm. We only customise
 * background, foreground, and cursor — xterm's default 16-colour
 * ANSI palette is fine for both modes once `minimumContrastRatio`
 * (set on the Terminal, not in `theme`) keeps bright greens/yellows
 * legible on white backgrounds.
 */
const TERM_THEMES = {
  dark: {
    background: "#0c0c0d",
    foreground: "#e4e4e7",
    cursor: "#e4e4e7",
  },
  light: {
    background: "#ffffff",
    foreground: "#18181b",
    cursor: "#18181b",
  },
} as const

/**
 * Embedded xterm.js terminal that renders a live PTY. Output flows in
 * through `onPtyData` (filtered to `jobId`); keystrokes go back out via
 * `ptyInput`. We re-fit on container resize so the spawned process sees
 * the actual visible cols/rows — important for the `hermes setup`
 * curses-ish prompts.
 *
 * Theme follows the app: xterm's `options.theme` is swapped whenever
 * the document theme flips (auto / light / dark from
 * `@hermes-x/theme`). The container background is bound to the same
 * palette so there's no white edge around a dark terminal (or vice
 * versa) while xterm repaints.
 *
 * The xterm instance is created once per mount and disposed on unmount;
 * theme changes mutate `options.theme` in place rather than re-mounting,
 * which keeps scrollback and the live PTY connection intact.
 */
function TerminalPanel({ jobId }: { jobId: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const rt = window.hermes.hermesRuntime
  const docTheme = useDocumentTheme()
  const palette = useMemo(() => TERM_THEMES[docTheme], [docTheme])

  // 1. Mount xterm once. Initial theme reads whatever the document is
  //    showing at mount time; subsequent flips are handled below.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      // Auto-darken ANSI brights that would be unreadable on the light
      // background; harmless in dark mode where contrast is already > 4.5.
      minimumContrastRatio: 4.5,
      theme: TERM_THEMES[docTheme],
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      fit.fit()
    } catch {
      // host may not have a layout yet; the ResizeObserver below will
      // fit again as soon as it does.
    }
    termRef.current = term
    fitRef.current = fit
    return () => {
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2. Pipe PTY output → terminal, filtered to this job.
  useEffect(() => {
    const off = rt.onPtyData((msg) => {
      if (msg.jobId !== jobId) return
      termRef.current?.write(msg.data)
    })
    return off
  }, [jobId, rt])

  // 3. Forward keystrokes back to the PTY.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const sub = term.onData((data: string) => {
      void rt.ptyInput({ jobId, data })
    })
    return () => sub.dispose()
  }, [jobId, rt])

  // 4. Refit + push the new size to the PTY whenever the host resizes.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const pushResize = () => {
      const fit = fitRef.current
      const term = termRef.current
      if (!fit || !term) return
      try {
        fit.fit()
      } catch {
        return
      }
      void rt.ptyResize({ jobId, cols: term.cols, rows: term.rows })
    }
    pushResize()
    const ro = new ResizeObserver(pushResize)
    ro.observe(host)
    return () => ro.disconnect()
  }, [jobId, rt])

  // 5. React to theme flips — xterm exposes `options.theme` as a setter
  //    that triggers an internal refresh of every rendered cell, so we
  //    don't need to clear the buffer or remount.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = palette
  }, [palette])

  return (
    <div
      className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/40 p-2 shadow-sm"
      style={{ backgroundColor: palette.background }}
    >
      <div ref={hostRef} className="h-full w-full" />
    </div>
  )
}
