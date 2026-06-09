import { getHermesStatus, SessionsProvider, useSessions } from "@hermes-x/core"
import { FullScreenChatView, useChatSessionRequester } from "@hermes-x/ui"
import { HomeView } from "@hermes-x/ui"
import { getPlatform } from "@hermes-x/platform"
import { SettingsView, type StartAgentTask } from "@hermes-x/ui"
import { useResolvedTheme } from "@hermes-x/ui"
import { useT } from "@hermes-x/i18n"
import { Loader2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react"

const SIDEBAR_VIEW_KEY = "settings.chat.sidebarView"

// TODO(phase-b): re-wire SlotRegistryProvider / extension boot when the
// WebView-based extension chrome is fully plumbed. For now the extension
// system runs main-side only; the renderer no longer boots renderer bundles.

import { ElectronChatEngineClient } from "./chat/electron-engine-client"
import { desktopCapabilities } from "./chat/desktop-capabilities"
import { makeDesktopFilesProvider } from "./chat/files-provider"
import { OnboardingWizard } from "./onboarding/OnboardingWizard"

type View = "chat" | "settings"

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

const TITLE_BAR_HEIGHT = 32
const MAC_TRAFFIC_LIGHT_RESERVE = 96

// loading       — first status probe in flight (brief)
// initializing  — hermes is installed; silently bringing the backend up on :9394
//                 (install-if-missing + start). Plumbing, NOT onboarding — just
//                 a spinner, never a wizard.
// init-error    — the silent init couldn't bring the backend up (rare); offer retry
// onboarding    — no hermes on the machine → the guided install wizard
// ready         — backend serving; show the app
type Phase = "loading" | "initializing" | "init-error" | "onboarding" | "ready"

export default function App() {
  return (
    <SessionsProvider>
      <AppInner />
    </SessionsProvider>
  )
}

function AppInner(): ReactElement {
  const { theme: resolvedTheme } = useResolvedTheme()
  const { t, language: resolvedLanguage } = useT()
  // Push the resolved language and theme to main on every change so extension
  // webviews see the same values the desktop UI is rendering. The renderer
  // is the only context that can resolve "auto" against navigator.language
  // and prefers-color-scheme.
  useEffect(() => {
    void window.hermes.setResolvedLanguage(resolvedLanguage)
  }, [resolvedLanguage])
  useEffect(() => {
    void window.hermes.setResolvedTheme(resolvedTheme)
  }, [resolvedTheme])
  const client = useMemo(() => new ElectronChatEngineClient(), [])
  // Desktop `@file` mention source. The provider lists files under the
  // ACTIVE session's bound workspace, so it needs the live active id — not
  // the one captured at first render. We keep the latest id in a ref and
  // hand the provider a stable getter that reads it, so the provider object
  // stays referentially stable (no re-instantiation churn through ChatSurface)
  // while always querying against the current session.
  const sessions = useSessions()
  const activeIdRef = useRef(sessions.activeId)
  activeIdRef.current = sessions.activeId
  const filesProvider = useMemo(
    () => makeDesktopFilesProvider(() => activeIdRef.current),
    [],
  )
  const [view, setView] = useState<View>("chat")
  const [phase, setPhase] = useState<Phase>("loading")
  // Sessions-aware prompt requester. Used by the extension chat.startSession
  // path below — minting the session HERE (not from main) is what makes
  // the ChatSurface drain land on a fresh, freshly-active id; doing the
  // storage write blindly from main races with sessions.activeId and
  // either lands the prompt on a stale session or on nothing, leaving
  // the user staring at the empty HomeView.
  const requestNewChat = useChatSessionRequester()
  // Settings panes (plugin install/uninstall) delegate operator work to the
  // agent through this: mint a fresh session with the task prompt, then bring
  // the chat view forward so the user watches the agent do it. Same pipeline
  // as the extension `chat.startSession` hand-off below.
  const startAgentTask = useCallback<StartAgentTask>(
    async (prompt, opts) => {
      await requestNewChat({ mode: "new", text: prompt, sourceApp: opts?.sourceApp })
      await getPlatform().storage.set({ [SIDEBAR_VIEW_KEY]: "chats" })
      setView("chat")
    },
    [requestNewChat],
  )
  useEffect(() => {
    return window.hermes.onChatStartSession(({ text }) => {
      void (async () => {
        try {
          // Mint a fresh session + queue the prompt. ChatSurface's
          // drain + auto-submit pipeline picks it up; send() lands on
          // the just-minted activeId.
          await requestNewChat({ mode: "new", text })
          // Move the sidebar back to chats (deselect whatever extension
          // activity was focused) and bring the top-level view back
          // from Settings if the user was over there.
          await getPlatform().storage.set({ [SIDEBAR_VIEW_KEY]: "chats" })
          setView("chat")
        } catch (err) {
          console.error("chat.startSession failed:", err)
        }
      })()
    })
  }, [requestNewChat])

  // Boot decision, split by what actually needs the USER:
  //   - backend already serving → straight in.
  //   - no hermes installed → the guided install wizard (the only user-facing
  //     setup; installing hermes is a real decision + needs a terminal).
  //   - hermes installed but backend down → SILENT init (ensureBackend brings
  //     :9394 up, installing the backplane the first time). Starting the backend
  //     is plumbing, not onboarding, so it stays behind a plain spinner — no
  //     wizard. Re-runnable so the wizard's onReady (after a hermes install)
  //     falls through to the same silent init.
  const runBoot = useCallback(async (signal: { cancelled: boolean }) => {
    setPhase("loading")
    if ((await getHermesStatus()).ok) {
      if (!signal.cancelled) setPhase("ready")
      return
    }
    const det = await window.hermes.hermesRuntime.detect()
    if (signal.cancelled) return
    if (!det.installed || !det.binary) {
      setPhase("onboarding")
      return
    }
    setPhase("initializing")
    const r = await window.hermes.hermesRuntime.ensureBackend({ binary: det.binary })
    if (!signal.cancelled) setPhase(r.ok ? "ready" : "init-error")
  }, [])

  useEffect(() => {
    const signal = { cancelled: false }
    void runBoot(signal)
    return () => {
      signal.cancelled = true
    }
  }, [runBoot])

  const openAgentDestination = (url: string) => getPlatform().shell.openExternal(url)
  const reboot = () => void runBoot({ cancelled: false })

  // Loading + initializing share a plain spinner — starting the backend is
  // plumbing, so the most we show is a one-line hint, never a wizard.
  if (phase === "loading" || phase === "initializing") {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        {phase === "initializing" && (
          <p className="text-sm text-muted-foreground">{t("app.initializing")}</p>
        )}
      </div>
    )
  }

  if (phase === "init-error") {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background px-8 text-center text-foreground">
        <p className="max-w-sm text-sm text-muted-foreground">{t("app.initError")}</p>
        <button
          type="button"
          onClick={reboot}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          {t("app.initRetry")}
        </button>
      </div>
    )
  }

  if (phase === "onboarding") {
    return <OnboardingWizard onReady={reboot} />
  }

  if (view === "settings") {
    return (
      <SettingsView
        capabilities={{ startAgentTask }}
        onGoHome={() => setView("chat")}
        sidebarHeaderLeftInset={IS_MAC ? MAC_TRAFFIC_LIGHT_RESERVE : 0}
        sidebarHeaderHeightPx={TITLE_BAR_HEIGHT}
        sidebarHeaderClassName="app-drag-region"
        paneHeaderClassName="app-drag-region"
        paneHeaderChromeHeightPx={TITLE_BAR_HEIGHT}
      />
    )
  }

  return (
    <FullScreenChatView
      client={client}
      capabilities={desktopCapabilities}
      mentionProviders={[filesProvider]}
      openSettings={(tab) => {
        if (tab) {
          window.location.hash = tab
        }
        setView("settings")
      }}
      openAgentDestination={openAgentDestination}
      topBarLeftInset={IS_MAC ? MAC_TRAFFIC_LIGHT_RESERVE : 0}
      topBarHeightPx={TITLE_BAR_HEIGHT}
      topBarClassName="app-drag-region"
      slots={{
        emptyState: (
          <HomeView
            onOpenChat={() => {}}
            onOpenSettings={() => setView("settings")}
            capabilities={{}}
            panelMode
          />
        ),
      }}
    />
  )
}
