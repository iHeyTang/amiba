import { getHermesStatus, SessionsProvider } from "@hermes-x/core"
import { FullScreenChatView } from "@hermes-x/ui"
import { HomeView } from "@hermes-x/ui"
import { getPlatform } from "@hermes-x/platform"
import { SettingsView } from "@hermes-x/ui"
import { useResolvedTheme } from "@hermes-x/ui"
import { useT } from "@hermes-x/i18n"
import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useState, type ReactElement } from "react"

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
