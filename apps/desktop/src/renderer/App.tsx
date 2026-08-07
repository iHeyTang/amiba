import { getHermesStatus, SessionsProvider, useSessions } from "@amiba/core";
import { FullScreenChatView, useChatSessionRequester } from "@amiba/ui";
import { HomeView } from "@amiba/ui";
import { getPlatform } from "@amiba/platform";
import { SettingsView, type StartAgentTask } from "@amiba/ui";
import { useResolvedTheme } from "@amiba/ui";
import { useT } from "@amiba/i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

const SIDEBAR_VIEW_KEY = "settings.chat.sidebarView";

// TODO(phase-b): re-wire SlotRegistryProvider / extension boot when the
// WebView-based extension chrome is fully plumbed. For now the extension
// system runs main-side only; the renderer no longer boots renderer bundles.

import { ElectronChatEngineClient } from "./chat/electron-engine-client";
import { desktopCapabilities } from "./chat/desktop-capabilities";
import { makeDesktopFilesProvider } from "./chat/files-provider";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import { StartupScreen } from "./StartupScreen";

type View = "chat" | "settings";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const TITLE_BAR_HEIGHT = 48;
const MAC_TRAFFIC_LIGHT_RESERVE = 96;

// loading       — first status probe in flight (brief)
// initializing  — managed Hermes is installed; silently bringing its backend up
//                 (install-if-missing + start). Plumbing, NOT onboarding — just
//                 a spinner, never a wizard.
// init-error    — the silent init couldn't bring the backend up (rare); offer retry
// onboarding    — no hermes on the machine → the guided install wizard
// ready         — backend serving; show the app
type Phase = "loading" | "initializing" | "init-error" | "onboarding" | "ready";

export default function App() {
  return (
    <SessionsProvider>
      <AppInner />
    </SessionsProvider>
  );
}

function AppInner(): ReactElement {
  const { theme: resolvedTheme } = useResolvedTheme();
  const { t, language: resolvedLanguage } = useT();
  // Push the resolved language and theme to main on every change so extension
  // webviews see the same values the desktop UI is rendering. The renderer
  // is the only context that can resolve "auto" against navigator.language
  // and prefers-color-scheme.
  useEffect(() => {
    void window.amiba.setResolvedLanguage(resolvedLanguage);
  }, [resolvedLanguage]);
  useEffect(() => {
    void window.amiba.setResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);
  const client = useMemo(() => new ElectronChatEngineClient(), []);
  // Desktop `@file` mention source. The provider lists files under the
  // ACTIVE session's bound workspace, so it needs the live active id — not
  // the one captured at first render. We keep the latest id in a ref and
  // hand the provider a stable getter that reads it, so the provider object
  // stays referentially stable (no re-instantiation churn through ChatSurface)
  // while always querying against the current session.
  const sessions = useSessions();
  const activeIdRef = useRef(sessions.activeId);
  activeIdRef.current = sessions.activeId;
  const filesProvider = useMemo(
    () => makeDesktopFilesProvider(() => activeIdRef.current),
    [],
  );
  const [view, setView] = useState<View>("chat");
  const [phase, setPhase] = useState<Phase>("loading");
  const [showReadyCurtain, setShowReadyCurtain] = useState(true);
  const pendingOpenSessionRef = useRef<string | null>(null);
  // Sessions-aware prompt requester. Used by the extension chat.startSession
  // path below — minting the session HERE (not from main) is what makes
  // the ChatSurface drain land on a fresh, freshly-active id; doing the
  // storage write blindly from main races with sessions.activeId and
  // either lands the prompt on a stale session or on nothing, leaving
  // the user staring at the empty HomeView.
  const requestNewChat = useChatSessionRequester();
  // Settings panes (plugin install/uninstall) delegate operator work to the
  // agent through this: mint a fresh session with the task prompt, then bring
  // the chat view forward so the user watches the agent do it. Same pipeline
  // as the extension `chat.startSession` hand-off below.
  const startAgentTask = useCallback<StartAgentTask>(
    async (prompt, opts) => {
      const agent = opts?.profileId ? { profileId: opts.profileId } : undefined;
      if (prompt.trim()) {
        await requestNewChat({
          mode: "new",
          text: prompt,
          sourceApp: opts?.sourceApp,
          agent,
        });
      } else {
        await sessions.createNew(agent);
      }
      await getPlatform().storage.set({ [SIDEBAR_VIEW_KEY]: "chats" });
      setView("chat");
    },
    [requestNewChat, sessions],
  );
  useEffect(() => {
    return window.amiba.onChatStartSession(({ text }) => {
      void (async () => {
        try {
          // Mint a fresh session + queue the prompt. ChatSurface's
          // drain + auto-submit pipeline picks it up; send() lands on
          // the just-minted activeId.
          await requestNewChat({ mode: "new", text });
          // Move the sidebar back to chats (deselect whatever extension
          // activity was focused) and bring the top-level view back
          // from Settings if the user was over there.
          await getPlatform().storage.set({ [SIDEBAR_VIEW_KEY]: "chats" });
          setView("chat");
        } catch (err) {
          console.error("chat.startSession failed:", err);
        }
      })();
    });
  }, [requestNewChat]);

  const openSessionFromNotifier = useCallback(
    async (sessionId: string) => {
      const target = sessionId.trim();
      if (!target) return;
      if (!sessions.ready) {
        pendingOpenSessionRef.current = target;
        return;
      }

      // A completed run may have been written by the background gateway or
      // cron watcher after this renderer last loaded its index.
      await sessions.refresh();
      await sessions.openTab(target);
      await getPlatform().storage.set({ [SIDEBAR_VIEW_KEY]: "chats" });
      setView("chat");
    },
    [sessions.openTab, sessions.ready, sessions.refresh],
  );

  useEffect(() => {
    return window.amiba.onOpenSession(({ sessionId }) => {
      void openSessionFromNotifier(sessionId).catch((err) => {
        console.error("notification session navigation failed:", err);
      });
    });
  }, [openSessionFromNotifier]);

  useEffect(() => {
    if (!sessions.ready || !pendingOpenSessionRef.current) return;
    const target = pendingOpenSessionRef.current;
    pendingOpenSessionRef.current = null;
    void openSessionFromNotifier(target).catch((err) => {
      console.error("deferred notification session navigation failed:", err);
    });
  }, [openSessionFromNotifier, sessions.ready]);

  // Boot decision, split by what actually needs the USER:
  //   - backend already serving → straight in.
  //   - no hermes installed → the guided install wizard (the only user-facing
  //     setup; installing hermes is a real decision + needs a terminal).
  //   - hermes installed but backend down → SILENT init (ensureBackend brings
  //     private backplane up, installing it the first time). Starting the backend
  //     is plumbing, not onboarding, so it stays behind a plain spinner — no
  //     wizard. Re-runnable so the wizard's onReady (after a hermes install)
  //     falls through to the same silent init.
  const runBoot = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      setPhase("loading");
      if ((await getHermesStatus()).ok) {
        if (!signal.cancelled) setPhase("ready");
        return;
      }
      const det = await window.amiba.hermesRuntime.detect();
      if (signal.cancelled) return;
      if (!det.installed || !det.binary) {
        setPhase("onboarding");
        return;
      }
      setPhase("initializing");
      const r = await window.amiba.hermesRuntime.ensureBackend({
        binary: det.binary,
      });
      if (!signal.cancelled) setPhase(r.ok ? "ready" : "init-error");
    } catch (err) {
      console.error("[boot] local service initialization failed:", err);
      if (!signal.cancelled) setPhase("init-error");
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void runBoot(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [runBoot]);

  useEffect(() => {
    if (phase !== "ready") {
      setShowReadyCurtain(true);
      return;
    }
    const timer = window.setTimeout(() => setShowReadyCurtain(false), 260);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const openAgentDestination = (url: string) =>
    getPlatform().shell.openExternal(url);
  const reboot = () => void runBoot({ cancelled: false });

  const readySurface =
    phase === "ready" ? (
      view === "settings" ? (
        <SettingsView
          capabilities={{ startAgentTask }}
          onGoHome={() => setView("chat")}
          sidebarHeaderLeftInset={IS_MAC ? MAC_TRAFFIC_LIGHT_RESERVE : 0}
          sidebarHeaderHeightPx={TITLE_BAR_HEIGHT}
          sidebarHeaderClassName="app-drag-region"
          paneHeaderClassName="app-drag-region"
          paneHeaderChromeHeightPx={TITLE_BAR_HEIGHT}
          toolActivitySource={{
            read: (days) => window.amiba.toolActivity.read(days),
            onChanged: (cb) => window.amiba.toolActivity.onChanged(cb),
          }}
        />
      ) : (
        <FullScreenChatView
          client={client}
          capabilities={desktopCapabilities}
          mentionProviders={[filesProvider]}
          openSettings={(tab) => {
            if (tab) {
              window.location.hash = tab;
            }
            setView("settings");
          }}
          openAgentDestination={openAgentDestination}
          topBarLeftInset={IS_MAC ? MAC_TRAFFIC_LIGHT_RESERVE : 0}
          topBarHeightPx={TITLE_BAR_HEIGHT}
          topBarClassName="app-drag-region"
          restoreSidebarViewOnMount={false}
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
    ) : null;

  // Keep one stable root while the service transitions from booting to ready.
  // The application mounts beneath the curtain first; the living mark then
  // fades away, so there is no blank frame or hard cut.
  if (phase === "loading" || phase === "initializing" || phase === "ready") {
    return (
      <div className="relative h-screen w-full overflow-hidden bg-background text-foreground">
        {readySurface && (
          <div className="amiba-ready-stage h-full w-full">{readySurface}</div>
        )}
        {(phase !== "ready" || showReadyCurtain) && (
          <StartupScreen
            leaving={phase === "ready"}
            message={t("app.initializing")}
            showStatus={phase === "initializing"}
          />
        )}
      </div>
    );
  }

  if (phase === "init-error") {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background px-8 text-center text-foreground">
        <p className="max-w-sm text-sm text-muted-foreground">
          {t("app.initError")}
        </p>
        <button
          type="button"
          onClick={reboot}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          {t("app.initRetry")}
        </button>
      </div>
    );
  }

  if (phase === "onboarding") {
    return <OnboardingWizard onReady={reboot} />;
  }

  return <OnboardingWizard onReady={reboot} />;
}
