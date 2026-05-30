import { getHermesStatus } from "@hermes-x/core"
import { FullScreenChatView } from "@hermes-x/chat-ui"
import { HomeView } from "@hermes-x/home-ui"
import { getPlatform } from "@hermes-x/platform"
import { SettingsView } from "@hermes-x/settings-ui"
import { useResolvedTheme } from "@hermes-x/theme"
import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { ElectronChatEngineClient } from "./chat/electron-engine-client"
import { desktopCapabilities } from "./chat/desktop-capabilities"
import { OnboardingWizard } from "./onboarding/OnboardingWizard"

type View = "chat" | "settings"

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

// 44px tall row anchors the custom affordances to the macOS traffic
// lights' true vertical centre. An h-6 (24px) button vertically centred
// in this 44px row lands on y=22, on the traffic-light baseline pixel-
// for-pixel.
// Reserve = 20 (left inset) + 3*12 (dots) + 2*8 (gaps) + 24 (breathing
//           room before the first custom icon)
//         = 96
const TITLE_BAR_HEIGHT = 44
const MAC_TRAFFIC_LIGHT_RESERVE = 96

/**
 * Desktop root. Two views inside a single BrowserWindow:
 *
 *   - "chat"     — `<FullScreenChatView />` is the home AND chat surface
 *                  in one. Its internal top bar becomes the OS chrome
 *                  row (traffic-light reserve + drag-region) and hosts
 *                  the wallpaper credit + Settings gear. The main pane
 *                  shows the home composer when there's no active
 *                  session and the chat thread when there is.
 *   - "settings" — `<SettingsView />` whose sidebar header IS the OS
 *                  chrome row, with a logo-back affordance to the chat.
 *
 * The previous separate "home" view (with its own immersive landing
 * page) has been folded into FullScreenChatView's empty state.
 *
 * Extension-only capabilities (page-context, learn, navigateOpenPolicy,
 * bookmarks, favicon) are intentionally absent here so the corresponding
 * UI sections hide.
 */
type Phase = "loading" | "onboarding" | "ready"

export default function App() {
  useResolvedTheme()
  const client = useMemo(() => new ElectronChatEngineClient(), [])
  const [view, setView] = useState<View>("chat")
  const [phase, setPhase] = useState<Phase>("loading")

  // Boot probe: is the Hermes backplane already reachable? If yes we go
  // straight to the chat surface; otherwise we fall into the onboarding
  // wizard, which walks the user through install + plugins + gateway
  // and signals `onReady` when the HTTP probe finally answers.
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
      openSettings={() => setView("settings")}
      openAgentDestination={openAgentDestination}
      topBarLeftInset={IS_MAC ? MAC_TRAFFIC_LIGHT_RESERVE : 0}
      topBarHeightPx={TITLE_BAR_HEIGHT}
      topBarClassName="app-drag-region"
      slots={{
        // The empty state in the chat surface IS the home page. HomeView
        // in panel mode drops its full-screen chrome (TopBar / wallpaper
        // / bottom dashboard) and keeps just the centred composer card,
        // so the chat right pane shows the exact home composer the user
        // remembers from the old standalone route. ``onOpenChat`` is a
        // no-op because we're already in the chat surface — HomeView's
        // submit still calls ``sessions.createNew()`` and writes the
        // typed text to ``home.pendingPrompt``; SidePanelView's drain
        // effect then auto-sends inside the freshly-active session.
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
