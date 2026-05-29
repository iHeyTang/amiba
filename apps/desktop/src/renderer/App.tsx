import { getHermesStatus, useWallpaper } from "@hermes-x/core"
import { FullScreenChatView } from "@hermes-x/chat-ui"
import { HomeView, WallpaperCredit } from "@hermes-x/home-ui"
import { getPlatform } from "@hermes-x/platform"
import { SettingsView } from "@hermes-x/settings-ui"
import { useResolvedTheme } from "@hermes-x/theme"
import { Loader2, Settings as SettingsIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { ElectronChatEngineClient } from "./chat/electron-engine-client"
import { OnboardingWizard } from "./onboarding/OnboardingWizard"

type View = "home" | "chat" | "settings"

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

// 44px tall row anchors the custom affordances to the macOS traffic
// lights' true vertical centre — empirically the dots render with their
// centres around y=22 on retina (slightly taller than their nominal
// 11–12pt due to the inner-shadow/border padding AppKit applies). An
// h-6 (24px) button vertically centred in this 44px row also lands on
// y=22, so the gear / Home / wallpaper-credit chip sit on the lights'
// baseline pixel-for-pixel. Main pins the cluster top at y=14 so we
// don't fight AppKit's minimum-inset clamping.
// Reserve = 20 (left inset) + 3*12 (dots) + 2*8 (gaps) + 24 (breathing
//           room before the first custom icon — keeps the gear from
//           crowding the green button)
//         = 96
const TITLE_BAR_HEIGHT = 44
const MAC_TRAFFIC_LIGHT_RESERVE = 96

/**
 * Home title bar — overlay row on top of the immersive wallpaper. Empty
 * draggable space on the left (traffic lights overlay it on macOS), the
 * wallpaper credit chip + Settings gear on the right (inside
 * `app-no-drag` so hover-to-expand works).
 */
function HomeTitleBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const wallpaper = useWallpaper()
  const ambientButton =
    wallpaper.enabled && wallpaper.mode === "light"
      ? "text-neutral-900/85 hover:bg-neutral-900/10 hover:text-neutral-900"
      : "text-white/85 hover:bg-white/15 hover:text-white"
  return (
    <header
      className="app-drag-region absolute inset-x-0 top-0 z-30 flex shrink-0 items-center gap-1 px-2"
      style={{
        height: TITLE_BAR_HEIGHT,
        paddingLeft: IS_MAC ? MAC_TRAFFIC_LIGHT_RESERVE : 12,
      }}>
      {/*
       * Left side is intentionally empty — on macOS the traffic-light
       * cluster overlays it, and everywhere else the bar just acts as
       * passive drag area. All custom affordances live on the right.
       */}
      <div className="flex-1" />
      {/* Right actions — wallpaper credit + settings gear, gear last so
       *  it pins to the very edge alongside the credit chip. */}
      <div className="app-no-drag flex items-center gap-1">
        {wallpaper.enabled && wallpaper.wallpaper && (
          <WallpaperCredit
            controller={wallpaper}
            ambientClass={
              wallpaper.mode === "light"
                ? "text-neutral-900/85 hover:text-neutral-900"
                : "text-white/85 hover:text-white"
            }
          />
        )}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${ambientButton}`}>
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  )
}

/**
 * Desktop root. Three views inside a single BrowserWindow:
 *
 *   - "home"     — `<HomeView />` with its internal header hidden; a
 *                  custom `<HomeTitleBar />` overlays the top edge with
 *                  wallpaper + settings actions sitting in the OS chrome
 *                  row (alongside the traffic lights).
 *   - "chat"     — `<FullScreenChatView />` whose internal TopBar becomes
 *                  the OS chrome row directly (left-inset for traffic
 *                  lights, drag-region for window-drag). No extra title
 *                  bar above it.
 *   - "settings" — `<SettingsView />` whose sidebar header IS the OS
 *                  chrome row (traffic-light reserve, clickable logo →
 *                  Home, drag-region).
 *
 * Extension-only capabilities (page-context, learn, navigateOpenPolicy,
 * bookmarks, favicon) are intentionally absent here so the corresponding
 * UI sections hide.
 */
type Phase = "loading" | "onboarding" | "ready"

export default function App() {
  useResolvedTheme()
  const client = useMemo(() => new ElectronChatEngineClient(), [])
  const [view, setView] = useState<View>("home")
  const [phase, setPhase] = useState<Phase>("loading")

  // Boot probe: is the Hermes backplane already reachable? If yes we go
  // straight to Home; otherwise we fall into the onboarding wizard, which
  // walks the user through install + plugins + gateway and signals
  // `onReady` when the HTTP probe finally answers.
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
        onGoHome={() => setView("home")}
        sidebarHeaderLeftInset={IS_MAC ? MAC_TRAFFIC_LIGHT_RESERVE : 0}
        sidebarHeaderHeightPx={TITLE_BAR_HEIGHT}
        sidebarHeaderClassName="app-drag-region"
        paneHeaderClassName="app-drag-region"
        paneHeaderChromeHeightPx={TITLE_BAR_HEIGHT}
      />
    )
  }

  if (view === "chat") {
    return (
      <FullScreenChatView
        client={client}
        capabilities={{}}
        openSettings={() => setView("settings")}
        openAgentDestination={openAgentDestination}
        onGoHome={() => setView("home")}
        topBarLeftInset={IS_MAC ? MAC_TRAFFIC_LIGHT_RESERVE : 0}
        topBarHeightPx={TITLE_BAR_HEIGHT}
        topBarClassName="app-drag-region"
      />
    )
  }

  // Home: title bar floats over the immersive wallpaper backdrop.
  return (
    <div className="relative h-full">
      <HomeTitleBar onOpenSettings={() => setView("settings")} />
      <HomeView
        onOpenChat={() => setView("chat")}
        onOpenSettings={() => setView("settings")}
        capabilities={{}}
        hideInternalHeader
      />
    </div>
  )
}
