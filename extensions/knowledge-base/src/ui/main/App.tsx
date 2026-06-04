/**
 * Knowledge Base sidebar page — port of KnowledgePanel.tsx.
 *
 * API surface changes from the old renderer model:
 *   - `host.ipc.invoke(...)` → `window.hermes.ipc.invoke(...)`
 *   - `host.settings.get/set(...)` → `window.hermes.settings.get/set(...)`
 *   - `useTranslate(host)` → `useT()` (inline hook below)
 *
 * This is a self-contained React tree bundled into its own HTML page
 * and rendered inside an Electron <webview>. It carries @hermes-x/ui
 * as a bundled dependency — bundle size is acceptable for the WebView model.
 */

import {
  ChevronDown,
  ChevronUp,
  FileText,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Streamdown } from "streamdown"

import {
  Button,
  cn,
  Input,
  Label,
  ScrollArea,
  Textarea,
} from "@hermes-x/ui"

import { hermes } from "../shared/hermes-bridge"
import { DisconnectedCard } from "../shared/DisconnectedCard"
import { useT, useTheme } from "../shared/i18n"
import type { BrainHealthInfo, LifecycleProbe, LifecycleStage } from "../shared/lifecycle"
import { BRAIN_DEFAULT_URL, BRAIN_URL_KEY } from "../../main/lib/constants"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
// App
// ---------------------------------------------------------------------------

export default function App() {
  useTheme()
  const t = useT()

  // Connection config — URL is configurable but defaults to loopback;
  // there is no token (local serve runs unauthenticated).
  const [url, setUrl] = useState(BRAIN_DEFAULT_URL)

  // Lifecycle stage, driven by lifecycle.probe. null = boot probe in flight.
  // Once resolved, drives which onboarding card OR the connected KB UI
  // gets rendered (see the switch below).
  const [stage, setStage] = useState<LifecycleStage | null>(null)
  const [healthInfo, setHealthInfo] = useState<BrainHealthInfo | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
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

  // Right-pane mode
  const [mode, setMode] = useState<"view" | "new">("view")
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [pageDetail, setPageDetail] = useState<BrainPage | null>(null)
  const [pageDetailLoading, setPageDetailLoading] = useState(false)
  const [pageDetailError, setPageDetailError] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Boot probe — single roundtrip resolves which onboarding stage to show.
  // -------------------------------------------------------------------------

  const probeStage = useCallback(async () => {
    try {
      const p = await hermes.ipc.invoke<LifecycleProbe>("lifecycle.probe")
      setStage(p.stage)
      setHealthInfo(p.health)
    } catch {
      // probe failed entirely — treat as stopped so the user sees the
      // "start" button rather than a blank pane.
      setStage("stopped")
      setHealthInfo(null)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const savedUrl = await hermes.settings.get<string>(BRAIN_URL_KEY, "")
      if (savedUrl) setUrl(savedUrl)
      await probeStage()
    })()
  }, [probeStage])

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  const testConnection = useCallback(
    async (testUrl?: string) => {
      setConnecting(true)
      setConnectionError(null)
      try {
        const u = (testUrl ?? url).trim()
        await hermes.settings.set(BRAIN_URL_KEY, u)
        await probeStage()
      } catch (e) {
        setConnectionError(
          t("connection.error", {
            error: (e as Error).message ?? String(e),
          }),
        )
      } finally {
        setConnecting(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, probeStage],
  )

  // -------------------------------------------------------------------------
  // One-click install — opens chat via IPC to desktop host
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  const doSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearchLoading(true)
    setSearchError(null)
    setSearchResults([])
    try {
      const results = await hermes.ipc.invoke<BrainSearchResult[]>(
        "call",
        { tool: "search", args: { query: searchQuery.trim(), limit: 20 } },
      )
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
      await hermes.ipc.invoke("call", {
        tool: "put_page",
        args: { slug: savedSlug, content: putContent.trim() },
      })
      setPutResult(t("putPage.success"))
      setPutSlug("")
      setPutContent("")
      setSelectedSlug(savedSlug)
      setMode("view")
      void loadPages()
    } catch (e) {
      setPutError((e as Error).message ?? String(e))
    } finally {
      setPutLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [putSlug, putContent])

  // -------------------------------------------------------------------------
  // Page list
  // -------------------------------------------------------------------------

  const loadPages = useCallback(async () => {
    setPagesLoading(true)
    setPagesError(null)
    try {
      const result = await hermes.ipc.invoke<
        BrainPageSummary[] | { pages: BrainPageSummary[] }
      >("call", { tool: "list_pages", args: { limit: 50 } })
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
  // Page detail
  // -------------------------------------------------------------------------

  const loadPageDetail = useCallback(async (slug: string) => {
    setPageDetailLoading(true)
    setPageDetailError(null)
    setPageDetail(null)
    try {
      const r = await hermes.ipc.invoke<BrainPage>(
        "call",
        { tool: "get_page", args: { slug } },
      )
      setPageDetail(r ?? null)
    } catch (e) {
      setPageDetailError((e as Error).message ?? String(e))
    } finally {
      setPageDetailLoading(false)
    }
  }, [])

  const connectedPaneActive = !!healthInfo
  useEffect(() => {
    if (!connectedPaneActive) return
    void loadPages()
  }, [connectedPaneActive, loadPages])

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

  if (stage === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (stage === "not-installed" || stage === "stopped") {
    return (
      <DisconnectedCard
        stage={stage}
        onProbeUpdate={(p) => {
          setStage(p.stage)
          setHealthInfo(p.health)
        }}
      />
    )
  }

  if (stage !== "ready") {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex min-h-full w-full justify-center px-6 py-6">
            <div className="my-auto flex w-full max-w-xl flex-col gap-5">
              {stage === "no-provider" && (
                <>
                  <header className="flex flex-col items-center gap-2 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <SettingsIcon className="h-6 w-6" />
                    </div>
                    <h1 className="text-xl font-semibold tracking-tight">
                      {t("stage.noProvider.title")}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      {t("stage.noProvider.description")}
                    </p>
                  </header>
                  <div className="rounded-lg border border-border bg-card/40 p-4 text-sm">
                    <p className="text-foreground/90">
                      {t("stage.noProvider.instructions")}
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <Button
                      onClick={() => void probeStage()}
                      disabled={connecting}
                      variant="outline"
                      size="sm"
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      {t("stage.noProvider.recheck")}
                    </Button>
                  </div>
                </>
              )}

              <div className="rounded-lg border border-border/60">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40"
                  aria-expanded={advancedOpen}
                >
                  <span className="inline-flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5" />
                    {t("tutorial.advanced.label")}
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
                      {t("tutorial.advanced.hint")}
                    </p>
                    <div className="space-y-1">
                      <Label htmlFor="brain-url" className="text-xs">
                        {t("connection.url")}
                      </Label>
                      <Input
                        id="brain-url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder={BRAIN_DEFAULT_URL}
                        className="h-8 font-mono text-xs"
                      />
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
                        {t("connection.test")}
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

  // Connected state
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

  function shouldRenderAsMarkdown(p: BrainPage | null): boolean {
    if (!p) return false
    const type = p.type?.toLowerCase()
    if (type === "code" || type === "binary" || type === "html" || type === "raw") {
      return false
    }
    return true
  }

  return (
    <div className="flex min-h-0 flex-1 bg-background">
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
                else if (e.key === "Escape") {
                  setSearchQuery("")
                  setSearchResults([])
                  setSearchError(null)
                }
              }}
              placeholder={t("search.placeholder")}
              className="h-7 w-full rounded bg-transparent pl-6 pr-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring/40"
            />
          </div>
          <button
            type="button"
            onClick={startNewPage}
            title={t("tabs.putPage")}
            aria-label={t("tabs.putPage")}
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
                    ? t("search.empty")
                    : t("pages.empty")}
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

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {mode === "new" ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto max-w-3xl space-y-4 p-6">
              <div className="space-y-1.5">
                <Label htmlFor="put-slug">
                  {t("putPage.slug")}
                </Label>
                <Input
                  id="put-slug"
                  value={putSlug}
                  onChange={(e) => setPutSlug(e.target.value)}
                  placeholder={t("putPage.slug.placeholder")}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="put-content">
                  {t("putPage.content")}
                </Label>
                <Textarea
                  id="put-content"
                  value={putContent}
                  onChange={(e) => setPutContent(e.target.value)}
                  placeholder={t("putPage.content.placeholder")}
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
                  {t("putPage.save")}
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
                        {t("view.empty")}
                      </p>
                    )
                  }
                  if (shouldRenderAsMarkdown(pageDetail)) {
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
              {t("view.placeholder")}
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
