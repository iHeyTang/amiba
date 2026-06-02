import {
  Check,
  Database,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import {
  BRAIN_DEFAULT_URL,
  BRAIN_TOKEN_STORAGE_KEY,
  BRAIN_URL_STORAGE_KEY,
} from "@hermes-x/core"
import { useT } from "@hermes-x/i18n"
import { getPlatform } from "@hermes-x/platform"

import {
  Button,
  Input,
  Label,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "../primitives"
import { SettingsPaneHeader } from "./SettingsPaneHeader"

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal bridge type for gbrain IPC calls. The full type lives in the
 * desktop's global.d.ts which the UI package can't see at build time,
 * so we declare the subset we need here.
 */
interface GBrainBridge {
  call: <T>(tool: string, args?: Record<string, unknown>) => Promise<T>
  health: () => Promise<{ status: string; version?: string } | null>
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsBrain() {
  const { t } = useT()

  // Connection config
  const [url, setUrl] = useState(BRAIN_DEFAULT_URL)
  const [token, setToken] = useState("")
  const [showConfig, setShowConfig] = useState(true)

  // Connection state
  const [healthInfo, setHealthInfo] = useState<BrainHealthInfo | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

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

  // Active tab
  const [activeTab, setActiveTab] = useState("search")

  // -------------------------------------------------------------------------
  // Load saved config
  // -------------------------------------------------------------------------

  useEffect(() => {
    void (async () => {
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
        setShowConfig(false)
        // Auto-test connection
        await testConnection(savedUrl, savedToken)
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

        const h = await gbrainHealth()
        if (!h) {
          setConnectionError(t("options.brain.connection.failed"))
          setShowConfig(true)
        } else {
          setHealthInfo(h)
          setShowConfig(false)
        }
      } catch (e) {
        setConnectionError(
          t("options.brain.connection.error", {
            error: (e as Error).message ?? String(e),
          }),
        )
        setShowConfig(true)
      } finally {
        setConnecting(false)
      }
    },
    [url, token, t],
  )

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
    try {
      await gbrainCall("put_page", {
        slug: putSlug.trim(),
        content: putContent.trim(),
      })
      setPutResult(t("options.brain.putPage.success"))
      setPutSlug("")
      setPutContent("")
    } catch (e) {
      setPutError((e as Error).message ?? String(e))
    } finally {
      setPutLoading(false)
    }
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
  // Render
  // -------------------------------------------------------------------------

  const connected = !!healthInfo

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <SettingsPaneHeader
        title={t("options.brain.title")}
        subtitle={t("options.brain.subtitle")}
      >
        {connected && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--success))]">
              <Check className="h-3 w-3" />
              {t("options.brain.connected")}
              {healthInfo.version && (
                <span className="text-muted-foreground">
                  v{healthInfo.version}
                </span>
              )}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setShowConfig(!showConfig)}
              title={t("options.brain.settings")}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </SettingsPaneHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-6">
          {/* Connection config */}
          {(showConfig || !connected) && (
            <section className="mb-6 space-y-3 rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-medium">
                {t("options.brain.connection.title")}
              </h3>
              <div className="space-y-1.5">
                <Label htmlFor="brain-url">
                  {t("options.brain.connection.url")}
                </Label>
                <Input
                  id="brain-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={BRAIN_DEFAULT_URL}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brain-token">
                  {t("options.brain.connection.token")}
                </Label>
                <Input
                  id="brain-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t("options.brain.connection.token.placeholder")}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => void testConnection()}
                  disabled={connecting}
                  size="sm"
                >
                  {connecting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {t("options.brain.connection.test")}
                </Button>
                {connectionError && (
                  <span className="text-xs text-destructive">
                    {connectionError}
                  </span>
                )}
              </div>
            </section>
          )}

          {/* Main content — only when connected */}
          {connected && (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="search" className="gap-1.5">
                  <Search className="h-3.5 w-3.5" />
                  {t("options.brain.tabs.search")}
                </TabsTrigger>
                <TabsTrigger value="putPage" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  {t("options.brain.tabs.putPage")}
                </TabsTrigger>
                <TabsTrigger value="pages" className="gap-1.5">
                  <Database className="h-3.5 w-3.5" />
                  {t("options.brain.tabs.pages")}
                </TabsTrigger>
              </TabsList>

              {/* Search tab */}
              <TabsContent value="search" className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void doSearch()
                    }}
                    placeholder={t("options.brain.search.placeholder")}
                    className="flex-1"
                  />
                  <Button
                    onClick={() => void doSearch()}
                    disabled={searchLoading || !searchQuery.trim()}
                  >
                    {searchLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {searchError && (
                  <p className="text-xs text-destructive">{searchError}</p>
                )}

                {searchResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {t("options.brain.search.results", {
                        count: searchResults.length,
                      })}
                    </p>
                    {searchResults.map((r, i) => (
                      <div
                        key={i}
                        className="rounded border border-border bg-card p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {r.title || r.slug}
                            </p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {r.slug}
                            </p>
                          </div>
                          {r.type && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {r.type}
                            </span>
                          )}
                        </div>
                        {r.snippet && (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground line-clamp-3">
                            {r.snippet}
                          </p>
                        )}
                        {typeof r.score === "number" && (
                          <p className="mt-1 text-[10px] tabular-nums text-muted-foreground/60">
                            score: {r.score.toFixed(3)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Put page tab */}
              <TabsContent value="putPage" className="space-y-4">
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
                    className="min-h-[200px] font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => void doPutPage()}
                    disabled={putLoading || !putSlug.trim() || !putContent.trim()}
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
                    <span className="text-xs text-destructive">
                      {putError}
                    </span>
                  )}
                </div>
              </TabsContent>

              {/* Pages tab */}
              <TabsContent value="pages" className="space-y-4">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadPages()}
                    disabled={pagesLoading}
                  >
                    {pagesLoading ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {t("options.brain.pages.load")}
                  </Button>
                </div>

                {pagesError && (
                  <p className="text-xs text-destructive">{pagesError}</p>
                )}

                {pages.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("options.brain.pages.count", {
                        count: pages.length,
                      })}
                    </p>
                    {pages.map((p, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded border border-border/60 bg-card px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            {p.title || p.slug}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {p.slug}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {p.type && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {p.type}
                            </span>
                          )}
                          {p.updated_at && (
                            <span className="text-[10px] text-muted-foreground/60">
                              {new Date(p.updated_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!pagesLoading && pages.length === 0 && !pagesError && (
                  <p className="text-xs text-muted-foreground">
                    {t("options.brain.pages.empty")}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
