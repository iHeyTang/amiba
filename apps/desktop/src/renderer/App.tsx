import { getHermesStatus, SessionsProvider } from "@hermes-x/core"
import { FullScreenChatView, useChatSessionRequester } from "@hermes-x/ui"
import { HomeView } from "@hermes-x/ui"
import { getPlatform } from "@hermes-x/platform"
import { SettingsView } from "@hermes-x/ui"
import { useResolvedTheme } from "@hermes-x/ui"
import { useT } from "@hermes-x/i18n"
import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useState, type ReactElement } from "react"

const SIDEBAR_VIEW_KEY = "settings.chat.sidebarView"

// TODO(phase-b): re-wire SlotRegistryProvider / extension boot when the
// WebView-based extension chrome is fully plumbed. For now the extension
// system runs main-side only; the renderer no longer boots renderer bundles.

import { ElectronChatEngineClient } from "./chat/electron-engine-client"
import { desktopCapabilities } from "./chat/desktop-capabilities"
import { OnboardingWizard } from "./onboarding/OnboardingWizard"

type View = "chat" | "settings"

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

const TITLE_BAR_HEIGHT = 32
const MAC_TRAFFIC_LIGHT_RESERVE = 96

type Phase = "loading" | "onboarding" | "ready"

export default function App() {
  return (
    <SessionsProvider>
      <AppInner />
    </SessionsProvider>
  )
}

function AppInner(): ReactElement {
  const { theme: resolvedTheme } = useResolvedTheme()
  const { language: resolvedLanguage } = useT()
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
  const [view, setView] = useState<View>("chat")
  const [phase, setPhase] = useState<Phase>("loading")
  // Sessions-aware prompt requester. Used by the extension chat.startSession
  // path below — minting the session HERE (not from main) is what makes
  // the ChatSurface drain land on a fresh, freshly-active id; doing the
  // storage write blindly from main races with sessions.activeId and
  // either lands the prompt on a stale session or on nothing, leaving
  // the user staring at the empty HomeView.
  const requestNewChat = useChatSessionRequester()
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

  useEffect(() => {
    let cancelled = false
    void getHermesStatus().then((s) => {
      if (cancelled) return
      setPhase(s.ok ? "ready" : "onboarding")
    })
    return () => {
      cancelled = true
    }
  }, [])

  const openAgentDestination = (url: string) => getPlatform().shell.openExternal(url)

  if (phase === "loading") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (phase === "onboarding") {
    return <OnboardingWizard onReady={() => setPhase("ready")} />
  }

  if (view === "settings") {
    return (
      <SettingsView
        capabilities={{}}
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
