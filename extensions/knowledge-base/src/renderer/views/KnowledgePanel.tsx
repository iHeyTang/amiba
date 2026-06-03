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

import type { RendererHost } from "@hermes-x/extension-api"
import {
  Button,
  cn,
  Input,
  Label,
  ScrollArea,
  Textarea,
} from "@hermes-x/ui"
import { useChatSessionRequester } from "@hermes-x/ui"

import { buildBrainInstallPrompt } from "./brain-install"
import {
  BRAIN_DEFAULT_URL,
  BRAIN_TOKEN_KEY,
  BRAIN_URL_KEY,
} from "./brain-storage"
import { useTranslate } from "../i18n"

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
// Component factory
// ---------------------------------------------------------------------------

export function makeKnowledgePanel(host: RendererHost) {
  return function KnowledgePanel(props: { onOpenChat?: () => void }) {
    const { onOpenChat } = props
    const t = useTranslate(host)
    const requestChatSession = useChatSessionRequester()

    // Connection config
    const [url, setUrl] = useState(BRAIN_DEFAULT_URL)
    const [token, setToken] = useState("")

    // Connection state
    const [healthInfo, setHealthInfo] = useState<BrainHealthInfo | null>(null)
    const [connecting, setConnecting] = useState(false)
    const [connectionError, setConnectionError] = useState<string | null>(null)
    const [bootLoading, setBootLoading] = useState(true)
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
    // Load saved config
    // -------------------------------------------------------------------------

    useEffect(() => {
      void (async () => {
        try {
          const savedUrl = await host.settings.get<string>(BRAIN_URL_KEY, "")
          const savedToken = await host.settings.get<string>(BRAIN_TOKEN_KEY, "")
          if (savedUrl) {
            setUrl(savedUrl)
            setToken(savedToken)
            await testConnection(savedUrl, savedToken)
          } else {
            // First run — silently probe the default port.
            try {
              const h = await host.ipc.invoke<void, { status: string; version?: string } | null>(
                "health",
                undefined,
              )
              if (h) {
                setUrl(BRAIN_DEFAULT_URL)
                setHealthInfo(h)
              }
            } catch {
              // ignore — probe failure just leaves us in unconnected state
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
          const u = (testUrl ?? url).trim()
          const tk = (testToken ?? token).trim()
          await host.settings.set(BRAIN_URL_KEY, u)
          await host.settings.set(BRAIN_TOKEN_KEY, tk)

          let h: { status: string; version?: string } | null = null
          try {
            h = await host.ipc.invoke<void, { status: string; version?: string } | null>(
              "health",
              undefined,
            )
          } catch {
            // health call failed
          }
          if (!h) {
            setConnectionError(t("connection.failed"))
          } else {
            let authOk = true
            let authError: string | null = null
            try {
              const auth = await host.ipc.invoke<void, { ok: boolean; reason?: string; error?: string }>(
                "verify-auth",
                undefined,
              )
              if (!auth.ok) {
                authOk = false
                authError =
                  auth.reason === "invalid-token"
                    ? t("connection.invalidToken")
                    : t("connection.error", { error: auth.error ?? "" })
              }
            } catch {
              // verify-auth not available — treat as ok
            }
            if (!authOk) {
              setConnectionError(authError)
            } else {
              setHealthInfo(h)
            }
          }
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
      [url, token],
    )

    // -------------------------------------------------------------------------
    // One-click install
    // -------------------------------------------------------------------------

    const startOneClickInstall = useCallback(async () => {
      if (!onOpenChat) return
      setConnectionError(null)
      try {
        // Seed default URL if not already configured
        const existingUrl = (await host.settings.get<string>(BRAIN_URL_KEY, "")).trim()
        if (!existingUrl) {
          await host.settings.set(BRAIN_URL_KEY, BRAIN_DEFAULT_URL)
        }
        await requestChatSession({
          text: buildBrainInstallPrompt("en"),
          sourceApp: "Brain installer",
          mode: "new",
        })
        onOpenChat()
      } catch (e) {
        setConnectionError(
          t("connection.error", {
            error: (e as Error).message ?? String(e),
          }),
        )
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onOpenChat, requestChatSession])

    // -------------------------------------------------------------------------
    // Search
    // -------------------------------------------------------------------------

    const doSearch = useCallback(async () => {
      if (!searchQuery.trim()) return
      setSearchLoading(true)
      setSearchError(null)
      setSearchResults([])
      try {
        const results = await host.ipc.invoke<
          { tool: string; args: Record<string, unknown> },
          BrainSearchResult[]
        >("call", { tool: "search", args: { query: searchQuery.trim(), limit: 20 } })
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
        await host.ipc.invoke("call", {
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
        const result = await host.ipc.invoke<
          { tool: string; args: Record<string, unknown> },
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
        const r = await host.ipc.invoke<{ tool: string; args: Record<string, unknown> }, BrainPage>(
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

    const connected = !!healthInfo

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
            <div className="flex min-h-full w-full justify-center px-6 py-6">
              <div className="my-auto flex w-full max-w-xl flex-col gap-5">
                <header className="flex flex-col items-center gap-2 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <h1 className="text-xl font-semibold tracking-tight">
                    {t("title")}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {t("tutorial.tagline")}
                  </p>
                </header>

                <ul className="space-y-2 text-sm">
                  {[
                    t("tutorial.bullet.recall"),
                    t("tutorial.bullet.link"),
                    t("tutorial.bullet.context"),
                  ].map((line, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="text-foreground/90">{line}</span>
                    </li>
                  ))}
                </ul>

                {onOpenChat && (
                  <div className="flex flex-col items-center gap-1.5">
                    <Button
                      onClick={() => void startOneClickInstall()}
                      size="lg"
                      className="min-w-[200px]"
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      {t("oneClick.button")}
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      {t("oneClick.description")}
                    </p>
                    {connectionError && (
                      <p className="text-center text-xs text-destructive">
                        {connectionError}
                      </p>
                    )}
                  </div>
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
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
                        <div className="space-y-1">
                          <Label htmlFor="brain-token" className="text-xs">
                            {t("connection.token")}
                          </Label>
                          <Input
                            id="brain-token"
                            type="password"
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            placeholder={t("connection.token.placeholder")}
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
      const t = p.type?.toLowerCase()
      if (t === "code" || t === "binary" || t === "html" || t === "raw") {
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
}
