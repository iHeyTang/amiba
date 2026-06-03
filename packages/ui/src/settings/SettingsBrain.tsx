import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Streamdown } from "streamdown"

import {
  BRAIN_DEFAULT_URL,
  BRAIN_TOKEN_STORAGE_KEY,
  BRAIN_URL_STORAGE_KEY,
} from "@hermes-x/core"
import { useT } from "@hermes-x/i18n"
import { getPlatform } from "@hermes-x/platform"

import { useChatSessionRequester } from "../chat/chat-session-request"
import {
  Button,
  cn,
  Input,
  Label,
  ScrollArea,
  Textarea,
} from "../primitives"
import {
  buildBrainInstallPrompt,
  buildBrainInstallStoragePatch,
} from "./brain-install"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrainHealthInfo {
  status: string
  version?: string
  db?: string
}

interface BrainSearchResult {
  slug: string
  title?: string
  type?: string
  score?: number
  snippet?: string
}

interface BrainPageSummary {
  slug: string
  title?: string
  type?: string
  updated_at?: string
}

/**
 * Full page payload returned by gbrain's `get_page`. We type permissively
 * because gbrain's payload has evolved across versions — `compiled_truth`
 * is the canonical body field on current releases (v0.42+), but older
 * builds returned `content` or `body`. The viewer picks whichever is
 * populated.
 */
interface BrainPage {
  slug: string
  title?: string
  type?: string
  compiled_truth?: string
  content?: string
  body?: string
  updated_at?: string
  created_at?: string
  tags?: string[]
  frontmatter?: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal bridge type for gbrain IPC calls. The full type lives in the
 * desktop's global.d.ts which the UI package can't see at build time,
 * so we declare the subset we need here.
 */
type VerifyAuthResult =
  | { ok: true }
  | { ok: false; reason: "invalid-token" | "other"; error: string }

interface GBrainBridge {
  call: <T>(tool: string, args?: Record<string, unknown>) => Promise<T>
  health: () => Promise<{ status: string; version?: string } | null>
  verifyAuth?: () => Promise<VerifyAuthResult>
  launcher?: {
    ensure: () => Promise<{
      ok: boolean
      started: boolean
      alreadyRunning: boolean
      binary: string
      pid?: number
      error?: string
    }>
  }
}

function getGBrainBridge(): GBrainBridge {
  return (window as unknown as { hermes: { gbrain: GBrainBridge } }).hermes.gbrain
}

function gbrainCall<T = unknown>(
  tool: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return getGBrainBridge().call<T>(tool, args)
}

function gbrainHealth(): Promise<{ status: string; version?: string } | null> {
  return getGBrainBridge().health()
}

/**
 * Authenticated probe — collapses to `ok: true` on hosts without the
 * bridge, since /health is the only check those hosts can do anyway.
 */
function gbrainVerifyAuth(): Promise<VerifyAuthResult> {
  const bridge = getGBrainBridge().verifyAuth
  if (!bridge) return Promise.resolve({ ok: true })
  return bridge()
}

/**
 * Probe → ensure (spawn if needed) → re-probe. Returns whichever
 * health payload becomes available, or null if both probes failed.
 * Used at workspace mount so a user who hasn't started `gbrain serve
 * --http` doesn't land on the tutorial unnecessarily.
 */
async function gbrainProbeWithAutoStart(): Promise<{
  status: string
  version?: string
} | null> {
  const first = await gbrainHealth()
  if (first) return first
  const launcher = getGBrainBridge().launcher
  if (!launcher) return null
  try {
    const r = await launcher.ensure()
    if (!r.ok) return null
  } catch {
    return null
  }
  return gbrainHealth()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SettingsBrainProps {
  /**
   * Switch the desktop shell over to the chat view. Required for the
   * one-click install flow: clicking the button writes a prefilled
   * prompt to `HOME_PENDING_PROMPT_KEY`, then we call this so the chat
   * surface mounts and drains the prompt into a fresh session. When the
   * host (e.g. browser extension's options page) can't navigate to a
   * chat, leave this undefined and the install button hides.
   */
  onOpenChat?: () => void
}

export function SettingsBrain({ onOpenChat }: SettingsBrainProps = {}) {
  const { t, language } = useT()
  const requestChatSession = useChatSessionRequester()

  // Connection config — read/written from this workspace's boot probe
  // and any prior config the user saved via Settings → Brain. The
  // inline editing form was moved out to Settings → Brain, so these
  // values are surfaced read-only here (via `healthInfo`); only the
  // probe path mutates them locally.
  const [url, setUrl] = useState(BRAIN_DEFAULT_URL)
  const [token, setToken] = useState("")

  // Connection state
  const [healthInfo, setHealthInfo] = useState<BrainHealthInfo | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  // True until the mount-time auto-test settles. Gates the initial
  // render between a centered spinner (don't flash the tutorial state
  // if we're about to learn the user is already connected) and the
  // real unconnected / connected view.
  const [bootLoading, setBootLoading] = useState(true)
  // "Advanced" disclosure in the unconnected tutorial view — reveals
  // the URL / Token form for users connecting to a manually-started
  // or remote GBrain. Closed by default to keep the page tutorial-flavor.
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Search
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<BrainSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Put page
  const [putSlug, setPutSlug] = useState("")
  const [putContent, setPutContent] = useState("")
  const [putLoading, setPutLoading] = useState(false)
  const [putResult, setPutResult] = useState<string | null>(null)
  const [putError, setPutError] = useState<string | null>(null)

  // Page list
  const [pages, setPages] = useState<BrainPageSummary[]>([])
  const [pagesLoading, setPagesLoading] = useState(false)
  const [pagesError, setPagesError] = useState<string | null>(null)

  // Right-pane mode. "view" renders the selected page; "new" renders
  // the put-page form. Selecting a sidebar item flips back to "view";
  // clicking + flips to "new" and resets the form.
  const [mode, setMode] = useState<"view" | "new">("view")
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [pageDetail, setPageDetail] = useState<BrainPage | null>(null)
  const [pageDetailLoading, setPageDetailLoading] = useState(false)
  const [pageDetailError, setPageDetailError] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Load saved config
  // -------------------------------------------------------------------------

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
        if (savedUrl) {
          setUrl(savedUrl)
          setToken(savedToken)
          // Auto-test connection. Errors here just leave us in the
          // unconnected state; surfaced via `connectionError` for the
          // advanced disclosure but not blocking the tutorial CTA.
          await testConnection(savedUrl, savedToken)
        } else {
          // First run — silently probe the default port (gbrain's own
          // `serve --http` default). If gbrain is already running the
          // user skips the tutorial entirely. We route through
          // `gbrainProbeWithAutoStart` so a healthy install that just
          // hasn't been started yet auto-spawns `gbrain serve --http`
          // detached and lands the user in the workspace anyway. We
          // deliberately do NOT call `testConnection` because that
          // persists to storage; staying empty preserves the "user
          // hasn't configured anything" state until they actually open
          // the advanced form. The main-process bridge falls back to
          // `BRAIN_DEFAULT_URL` when storage is empty.
          const h = await gbrainProbeWithAutoStart()
          if (h) {
            setUrl(BRAIN_DEFAULT_URL)
            setHealthInfo(h)
          }
        }
      } finally {
        setBootLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  const testConnection = useCallback(
    async (testUrl?: string, testToken?: string) => {
      setConnecting(true)
      setConnectionError(null)
      setHealthInfo(null)
      try {
        // Save config first so the main process reads the latest values
        const u = (testUrl ?? url).trim()
        const tk = (testToken ?? token).trim()
        await getPlatform().storage.set({
          [BRAIN_URL_STORAGE_KEY]: u,
          [BRAIN_TOKEN_STORAGE_KEY]: tk,
        })

        const h = await gbrainProbeWithAutoStart()
        if (!h) {
          setConnectionError(t("options.brain.connection.failed"))
        } else {
          // /health is unauthenticated — also probe /mcp so an invalid
          // token surfaces here rather than at the first search/list.
          const auth = await gbrainVerifyAuth()
          if (!auth.ok) {
            setConnectionError(
              auth.reason === "invalid-token"
                ? t("options.brain.connection.invalidToken")
                : t("options.brain.connection.error", { error: auth.error }),
            )
          } else {
            setHealthInfo(h)
          }
        }
      } catch (e) {
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

  // -------------------------------------------------------------------------
  // One-click install
  //
  // Single shot: build the storage patch (default URL if user hasn't set
  // one), hand the install prompt to the agent via the chat-session
  // request abstraction, then switch the host view over to chat so the
  // agent has somewhere to talk. No polling, no transient state — the
  // status of the install lives in the conversation. When the user
  // navigates back to this pane, the mount-time `testConnection` re-runs
  // and reflects whatever `gbrain serve --http` has actually done.
  // -------------------------------------------------------------------------

  const startOneClickInstall = useCallback(async () => {
    if (!onOpenChat) return
    setConnectionError(null)
    try {
      const storagePatch = await buildBrainInstallStoragePatch()
      await requestChatSession({
        text: buildBrainInstallPrompt(language),
        sourceApp: "Brain installer",
        storagePatch,
        // Force a fresh session — install is a discrete one-shot task,
        // we don't want it merged into whatever conversation the user
        // happened to have active.
        mode: "new",
      })
      onOpenChat()
    } catch (e) {
      setConnectionError(
        t("options.brain.connection.error", {
          error: (e as Error).message ?? String(e),
        }),
      )
    }
  }, [language, onOpenChat, requestChatSession, t])

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  const doSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearchLoading(true)
    setSearchError(null)
    setSearchResults([])
    try {
      const results = await gbrainCall<BrainSearchResult[]>("search", {
        query: searchQuery.trim(),
        limit: 20,
      })
      setSearchResults(Array.isArray(results) ? results : [])
    } catch (e) {
      setSearchError((e as Error).message ?? String(e))
    } finally {
      setSearchLoading(false)
    }
  }, [searchQuery])

  // -------------------------------------------------------------------------
  // Put page
  // -------------------------------------------------------------------------

  const doPutPage = useCallback(async () => {
    if (!putSlug.trim() || !putContent.trim()) return
    setPutLoading(true)
    setPutError(null)
    setPutResult(null)
    const savedSlug = putSlug.trim()
    try {
      await gbrainCall("put_page", {
        slug: savedSlug,
        content: putContent.trim(),
      })
      setPutResult(t("options.brain.putPage.success"))
      setPutSlug("")
      setPutContent("")
      // After save, refresh the sidebar list and jump the right pane to
      // the just-saved page so the round-trip feels coherent — no need
      // for the user to manually re-navigate.
      setSelectedSlug(savedSlug)
      setMode("view")
      void loadPages()
    } catch (e) {
      setPutError((e as Error).message ?? String(e))
    } finally {
      setPutLoading(false)
    }
    // `loadPages` is stable (no deps), pulling it in would just churn
    // the callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [putSlug, putContent, t])

  // -------------------------------------------------------------------------
  // Page list
  // -------------------------------------------------------------------------

  const loadPages = useCallback(async () => {
    setPagesLoading(true)
    setPagesError(null)
    try {
      const result = await gbrainCall<BrainPageSummary[] | { pages: BrainPageSummary[] }>(
        "list_pages",
        { limit: 50 },
      )
      if (Array.isArray(result)) {
        setPages(result)
      } else if (result && typeof result === "object" && "pages" in result) {
        setPages(result.pages)
      } else {
        setPages([])
      }
    } catch (e) {
      setPagesError((e as Error).message ?? String(e))
    } finally {
      setPagesLoading(false)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Page detail (right-pane viewer)
  // -------------------------------------------------------------------------

  const loadPageDetail = useCallback(async (slug: string) => {
    setPageDetailLoading(true)
    setPageDetailError(null)
    setPageDetail(null)
    try {
      const r = await gbrainCall<BrainPage>("get_page", { slug })
      setPageDetail(r ?? null)
    } catch (e) {
      setPageDetailError((e as Error).message ?? String(e))
    } finally {
      setPageDetailLoading(false)
    }
  }, [])

  // Auto-load the page list once we land in the connected state — the
  // sidebar IS the page list, so we can't make the user click a button
  // to populate it.
  const connectedPaneActive = !!healthInfo
  useEffect(() => {
    if (!connectedPaneActive) return
    void loadPages()
  }, [connectedPaneActive, loadPages])

  // Auto-fetch the page body whenever the user selects a different slug.
  useEffect(() => {
    if (mode !== "view") return
    if (!selectedSlug) return
    void loadPageDetail(selectedSlug)
  }, [mode, selectedSlug, loadPageDetail])

  const startNewPage = useCallback(() => {
    setMode("new")
    setSelectedSlug(null)
    setPageDetail(null)
    setPageDetailError(null)
    setPutSlug("")
    setPutContent("")
    setPutResult(null)
    setPutError(null)
  }, [])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const connected = !!healthInfo

  // -------------------------------------------------------------------------
  // Render — three distinct surfaces:
  //
  //   1. Boot loading: mount-time auto-test still in flight. Centered
  //      spinner so we don't flash the tutorial state for users who
  //      already have a working connection.
  //
  //   2. Unconnected (tutorial): hero + value pitch + single CTA, with
  //      the URL/Token form hidden behind an "Advanced" disclosure for
  //      power users connecting to a manually-started or remote brain.
  //
  //   3. Connected: existing search / put-page / list-pages workspace
  //      with a subtle status chip + gear in the header.
  // -------------------------------------------------------------------------

  if (bootLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <ScrollArea className="min-h-0 flex-1">
          {/* `min-h-full` + `my-auto` on the inner card keeps the page
              vertically centered when the (collapsed) tutorial fits in
              the viewport, and falls back to natural top-aligned scroll
              when the manual-config form pushes the content past the
              viewport — so a partial expansion never produces a half-
              scrolled, off-centre layout. */}
          <div className="flex min-h-full w-full justify-center px-6 py-6">
            <div className="my-auto flex w-full max-w-xl flex-col gap-5">
              {/* Hero — icon, title, tagline. Centered so the page reads
                  as a feature pitch rather than a settings form. */}
              <header className="flex flex-col items-center gap-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <BookOpen className="h-6 w-6" />
                </div>
                <h1 className="text-xl font-semibold tracking-tight">
                  {t("options.brain.title")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("options.brain.tutorial.tagline")}
                </p>
              </header>

              {/* Value pitch — three short bullets. Kept brief so they
                  read as a benefit list, not a feature manual. */}
              <ul className="space-y-2 text-sm">
                {[
                  t("options.brain.tutorial.bullet.recall"),
                  t("options.brain.tutorial.bullet.link"),
                  t("options.brain.tutorial.bullet.context"),
                ].map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-foreground/90">{line}</span>
                  </li>
                ))}
              </ul>

              {/* Primary CTA — single shot, fires the install conversation
                  and hands the view off to chat. */}
              {onOpenChat && (
                <div className="flex flex-col items-center gap-1.5">
                  <Button
                    onClick={() => void startOneClickInstall()}
                    size="lg"
                    className="min-w-[200px]"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    {t("options.brain.oneClick.button")}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    {t("options.brain.oneClick.description")}
                  </p>
                  {connectionError && (
                    <p className="text-center text-xs text-destructive">
                      {connectionError}
                    </p>
                  )}
                </div>
              )}

              {/* Advanced — manual connect to a running brain. Closed by
                  default; opens to reveal the URL / Token form. The header
                  stays a button (not a <details>) so we can lay out the
                  hint + chevron without browser-default styling. */}
              <div className="rounded-lg border border-border/60">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40"
                  aria-expanded={advancedOpen}
                >
                  <span className="inline-flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5" />
                    {t("options.brain.tutorial.advanced.label")}
                  </span>
                  {advancedOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {advancedOpen && (
                  <div className="space-y-2.5 border-t border-border/60 p-3">
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {t("options.brain.tutorial.advanced.hint")}
                    </p>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="brain-url" className="text-xs">
                          {t("options.brain.connection.url")}
                        </Label>
                        <Input
                          id="brain-url"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder={BRAIN_DEFAULT_URL}
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="brain-token" className="text-xs">
                          {t("options.brain.connection.token")}
                        </Label>
                        <Input
                          id="brain-token"
                          type="password"
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          placeholder={t(
                            "options.brain.connection.token.placeholder",
                          )}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => void testConnection()}
                        disabled={connecting}
                        size="sm"
                        variant="outline"
                      >
                        {connecting ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {t("options.brain.connection.test")}
                      </Button>
                      {connectionError && advancedOpen && (
                        <span className="text-xs text-destructive">
                          {connectionError}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    )
  }

  // ---------------------------------------------------------------------
  // Connected state — Notion-style "directory + content":
  //
  //   ┌──────────────────────────────┬─────────────────────────────┐
  //   │ 🔍 search…           [+ new] │                             │
  //   ├──────────────────────────────┤      page viewer (right)    │
  //   │  page-1                      │                             │
  //   │  page-2                      │      OR put-page form       │
  //   │  …                           │      when mode = "new"      │
  //   └──────────────────────────────┴─────────────────────────────┘
  //
  // No workspace header — connection config lives in Settings → Brain
  // (the activity-bar destination above this surface already conveys
  // "you are in the knowledge base"). Skipping a header is what
  // Chats / Scheduled do too.
  // ---------------------------------------------------------------------

  // Sidebar item set: search results when the user has typed a query
  // and triggered a search; otherwise the freshly-listed pages. Same
  // row component renders both.
  const sidebarShowsSearch = searchResults.length > 0 || searchLoading
  const sidebarItems: BrainPageSummary[] = sidebarShowsSearch
    ? searchResults.map((r) => ({
        slug: r.slug,
        title: r.title,
        type: r.type,
      }))
    : pages

  function pickPageBody(p: BrainPage | null): string {
    if (!p) return ""
    return p.compiled_truth ?? p.content ?? p.body ?? ""
  }

  /**
   * Pick a renderer for the page body. gbrain is markdown-first — almost
   * every page is markdown, and plain text degrades gracefully through a
   * markdown renderer (just renders as one paragraph). We only fall back
   * to the raw-text `<pre>` when the page is explicitly tagged with a
   * non-text type (`code`, `binary`, `html`); for anything else, including
   * pages with no `type` set, markdown is the right default.
   */
  function shouldRenderAsMarkdown(p: BrainPage | null): boolean {
    if (!p) return false
    const t = p.type?.toLowerCase()
    if (t === "code" || t === "binary" || t === "html" || t === "raw") {
      return false
    }
    return true
  }

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      {/* ── Sidebar: search + new + directory ──
          VSCode-style affordances: the search input is a borderless
          filter bar that quietly lights up on focus, the "new page"
          action is a ghost icon button. Both sit on a single thin row
          so the chrome reads as part of the sidebar background, not as
          a heavy form panel. */}
      <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-border bg-muted/15">
        <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doSearch()
                // Clearing the box snaps the sidebar back to the page
                // list — no need for an explicit "exit search" button.
                else if (e.key === "Escape") {
                  setSearchQuery("")
                  setSearchResults([])
                  setSearchError(null)
                }
              }}
              placeholder={t("options.brain.search.placeholder")}
              className="h-7 w-full rounded bg-transparent pl-6 pr-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring/40"
            />
          </div>
          <button
            type="button"
            onClick={startNewPage}
            title={t("options.brain.tabs.putPage")}
            aria-label={t("options.brain.tabs.putPage")}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <nav className="flex flex-col py-1">
            {sidebarShowsSearch && searchError && (
              <p className="px-3 py-2 text-[11px] text-destructive">
                {searchError}
              </p>
            )}
            {!sidebarShowsSearch && pagesError && (
              <p className="px-3 py-2 text-[11px] text-destructive">
                {pagesError}
              </p>
            )}
            {(pagesLoading || searchLoading) && sidebarItems.length === 0 && (
              <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                {t("common.loading")}
              </div>
            )}
            {!pagesLoading &&
              !searchLoading &&
              sidebarItems.length === 0 &&
              !pagesError &&
              !searchError && (
                <p className="px-3 py-3 text-[11px] text-muted-foreground">
                  {sidebarShowsSearch
                    ? t("options.brain.search.empty")
                    : t("options.brain.pages.empty")}
                </p>
              )}
            {sidebarItems.map((p) => {
              const active = mode === "view" && p.slug === selectedSlug
              return (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => {
                    setMode("view")
                    setSelectedSlug(p.slug)
                  }}
                  title={p.slug}
                  className={cn(
                    "flex flex-col items-start gap-0.5 px-3 py-1.5 text-left text-xs transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="w-full truncate text-foreground/90">
                    {p.title || p.slug}
                  </span>
                  <span className="w-full truncate font-mono text-[10px] text-muted-foreground/70">
                    {p.slug}
                  </span>
                </button>
              )
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* ── Main: viewer or new-page form ── */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {mode === "new" ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto max-w-3xl space-y-4 p-6">
              <div className="space-y-1.5">
                <Label htmlFor="put-slug">
                  {t("options.brain.putPage.slug")}
                </Label>
                <Input
                  id="put-slug"
                  value={putSlug}
                  onChange={(e) => setPutSlug(e.target.value)}
                  placeholder={t("options.brain.putPage.slug.placeholder")}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="put-content">
                  {t("options.brain.putPage.content")}
                </Label>
                <Textarea
                  id="put-content"
                  value={putContent}
                  onChange={(e) => setPutContent(e.target.value)}
                  placeholder={t(
                    "options.brain.putPage.content.placeholder",
                  )}
                  className="min-h-[300px] font-mono text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => void doPutPage()}
                  disabled={
                    putLoading || !putSlug.trim() || !putContent.trim()
                  }
                >
                  {putLoading ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {t("options.brain.putPage.save")}
                </Button>
                {putResult && (
                  <span className="text-xs text-[hsl(var(--success))]">
                    {putResult}
                  </span>
                )}
                {putError && (
                  <span className="text-xs text-destructive">{putError}</span>
                )}
              </div>
            </div>
          </ScrollArea>
        ) : selectedSlug ? (
          <>
            <div className="flex shrink-0 items-baseline gap-2 border-b border-border/50 bg-muted/10 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {pageDetail?.title || selectedSlug}
              </span>
              <span
                className="shrink-0 font-mono text-[10px] text-muted-foreground"
                title={selectedSlug}
              >
                {selectedSlug}
              </span>
              {pageDetail?.updated_at && (
                <span className="shrink-0 text-[10px] text-muted-foreground/70">
                  {new Date(pageDetail.updated_at).toLocaleString()}
                </span>
              )}
            </div>
            <ScrollArea className="min-h-0 flex-1 bg-background">
              {pageDetailLoading ? (
                <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {t("common.loading")}
                </div>
              ) : pageDetailError ? (
                <p className="px-4 py-3 text-xs text-destructive">
                  {pageDetailError}
                </p>
              ) : pageDetail ? (
                (() => {
                  const body = pickPageBody(pageDetail)
                  if (!body) {
                    return (
                      <p className="px-6 py-4 text-xs text-muted-foreground">
                        {t("options.brain.view.empty")}
                      </p>
                    )
                  }
                  if (shouldRenderAsMarkdown(pageDetail)) {
                    // Static mode (no caret / streaming) — the body is
                    // loaded in one shot from gbrain. `chat-md` is the
                    // same typography scope the assistant bubbles use,
                    // so headings / lists / code blocks read consistently
                    // across surfaces.
                    return (
                      <div className="px-6 py-4">
                        <Streamdown
                          mode="static"
                          className="chat-md break-words"
                        >
                          {body}
                        </Streamdown>
                      </div>
                    )
                  }
                  return (
                    <pre className="whitespace-pre-wrap break-words px-6 py-4 font-mono text-[12px] leading-relaxed">
                      {body}
                    </pre>
                  )
                })()
              ) : null}
            </ScrollArea>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <p className="max-w-xs text-center text-xs text-muted-foreground">
              {t("options.brain.view.placeholder")}
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
