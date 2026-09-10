import { useEffect, useState } from "react";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  Input,
  SidebarExpandControl,
  usePluginT,
} from "@amiba/ui/plugin";
import {
  Brain,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type {
  MemoryEntry,
  MemoryKind,
  MemoryOverview,
  MemoryPage as PageData,
  MemoryQuery,
} from "../dashboard.js";

export interface MemoryAdapter {
  login(password: string): Promise<void>;
  overview(): Promise<MemoryOverview>;
  browse(query: MemoryQuery): Promise<PageData>;
}
export type MemoryPageProps = Partial<PropsRuntime<"amiba.workspace.view">> & {
  adapter: MemoryAdapter;
  expandSidebar(): void;
  openSettings(): void;
};
const kinds: MemoryKind[] = ["traces", "policies", "worldModels", "skills"];
const labels = {
  traces: ["记忆", "Memories"],
  policies: ["经验", "Experiences"],
  worldModels: ["环境知识", "Environment"],
  skills: ["技能", "Skills"],
  summary: ["摘要", "Summary"],
  userText: ["用户消息", "User message"],
  agentText: ["助手回复", "Assistant response"],
  trigger: ["适用场景", "When to use"],
  procedure: ["操作步骤", "Procedure"],
  verification: ["验证方式", "Verification"],
  boundary: ["适用边界", "Boundaries"],
  body: ["知识内容", "Knowledge"],
  invocationGuide: ["使用指南", "Usage guide"],
  active: ["已启用", "Active"],
  candidate: ["待验证", "Candidate"],
  archived: ["已归档", "Archived"],
} as const;

export function MemoryPage({
  adapter,
  expandSidebar,
  openSettings,
  chromeHeightPx = 44,
  topBarLeftInset = 0,
  sidebarCollapsed = false,
  showSidebarExpandControl = false,
}: MemoryPageProps) {
  const { language } = usePluginT();
  const zh = language.startsWith("zh");
  const copy = (cn: string, en: string) => (zh ? cn : en);
  const label = (key: string) =>
    key in labels ? labels[key as keyof typeof labels][zh ? 0 : 1] : key;
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [kind, setKind] = useState<MemoryKind>("traces");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MemoryEntry | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(input.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    let current = true;
    setOverviewError(false);
    void adapter
      .overview()
      .then((value) => {
        if (current) setOverview(value);
      })
      .catch(() => {
        if (current) {
          setOverview(null);
          setOverviewError(true);
        }
      });
    return () => {
      current = false;
    };
  }, [adapter, revision]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setPage(null);
    setSelected(null);
    void adapter
      .browse({ kind, query, offset })
      .then((value) => {
        if (current) setPage(value);
      })
      .catch((cause) => {
        if (current)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [adapter, kind, query, offset, revision]);
  const date = (value: number | null) =>
    value === null || !Number.isFinite(new Date(value).getTime())
      ? ""
      : new Date(value).toLocaleString(zh ? "zh-CN" : "en-US");
  const errorText = error?.includes("MEMOS_AUTH_REQUIRED")
    ? copy(
        "MemOS 已启用密码保护，请输入管理密码以查看记忆。",
        "MemOS is password protected. Enter your manager password to view memories.",
      )
    : copy(
        "暂时无法读取记忆。请重试，或在记忆设置中检查 MemOS 运行状态。",
        "Memories are unavailable. Retry or check MemOS in memory settings.",
      );
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <header
        className="app-drag flex shrink-0 items-center pr-3"
        style={{
          height: chromeHeightPx,
          paddingLeft: sidebarCollapsed ? Math.max(topBarLeftInset, 12) : 10,
        }}
      >
        <SidebarExpandControl
          collapsed={sidebarCollapsed}
          visible={showSidebarExpandControl}
          onExpand={expandSidebar}
        />
        <div className="app-no-drag ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={openSettings}>
            {copy("记忆设置", "Memory settings")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={copy("刷新记忆", "Refresh memories")}
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 sm:px-8">
        <div className="shrink-0 pb-5 pt-4">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{copy("记忆", "Memory")}</h1>
            <span className="ml-1 text-xs text-muted-foreground">MemOS</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {copy(
              "查看 amiba 记住的对话、积累的经验，以及它们的来源。",
              "Explore the conversations and experience amiba remembers, and where they came from.",
            )}
          </p>
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {overviewError
              ? copy("概览暂不可用", "Overview unavailable")
              : overview
                ? copy(
                    `从 ${overview.episodes} 个任务中积累 · ${overview.traces} 条记忆`,
                    `Collected across ${overview.episodes} tasks · ${overview.traces} memories`,
                  )
                : copy("正在读取记忆概览…", "Loading overview…")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={copy("记忆分类", "Memory categories")}
          >
            {kinds.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={kind === value ? "secondary" : "ghost"}
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);
                  setOffset(0);
                }}
              >
                {label(value)}
                <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                  {overview?.[value] ?? "—"}
                </span>
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:w-60">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
            />
            <Input
              className="pl-9"
              maxLength={512}
              aria-label={copy("搜索当前分类", "Search this category")}
              placeholder={copy("搜索当前分类…", "Search this category…")}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <section
            aria-label={copy("记忆列表", "Memory list")}
            aria-busy={loading}
            className={`min-w-0 flex-1 overflow-y-auto ${selected ? "hidden md:block md:max-w-[42%] md:border-r md:border-border" : ""}`}
          >
            {loading ? (
              <p role="status" className="p-6 text-sm text-muted-foreground">
                {copy("正在读取…", "Loading…")}
              </p>
            ) : error ? (
              <div role="alert" className="space-y-3 p-6">
                <p className="text-sm text-muted-foreground">{errorText}</p>
                {error.includes("MEMOS_AUTH_REQUIRED") && (
                  <form
                    className="max-w-sm space-y-3"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      setSigningIn(true);
                      setLoginError(false);
                      try {
                        await adapter.login(password);
                        setRevision((value) => value + 1);
                      } catch {
                        setLoginError(true);
                      } finally {
                        setPassword("");
                        setSigningIn(false);
                      }
                    }}
                  >
                    <Input
                      type="password"
                      autoComplete="current-password"
                      aria-label={copy("MemOS 管理密码", "MemOS password")}
                      placeholder={copy("管理密码", "Manager password")}
                      value={password}
                      maxLength={1024}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    {loginError && (
                      <p role="alert" className="text-sm text-destructive">
                        {copy(
                          "登录失败，请检查密码或稍后重试。",
                          "Sign-in failed. Check your password or try again later.",
                        )}
                      </p>
                    )}
                    <Button
                      type="submit"
                      size="sm"
                      disabled={signingIn || !password.trim()}
                    >
                      {signingIn
                        ? copy("正在登录…", "Signing in…")
                        : copy("解锁记忆", "Unlock memories")}
                    </Button>
                  </form>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  {copy("重试", "Retry")}
                </Button>
              </div>
            ) : page?.entries.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <Brain className="mx-auto mb-4 h-7 w-7 text-muted-foreground" />
                <p className="text-sm">
                  {query
                    ? copy("没有找到匹配内容", "No matching memories")
                    : copy("这里还没有内容", "Nothing here yet")}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {query
                    ? copy("试试其他关键词。", "Try another search.")
                    : copy(
                        "继续与 amiba 对话，MemOS 会按配置自动积累记忆。",
                        "Keep talking with amiba. MemOS captures memories according to its configuration.",
                      )}
                </p>
              </div>
            ) : (
              page?.entries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => setSelected(entry)}
                  aria-pressed={selected?.id === entry.id}
                  className={`block w-full border-b border-border/50 px-4 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${selected?.id === entry.id ? "bg-muted/60" : ""}`}
                >
                  <p className="line-clamp-2 text-sm font-medium">
                    {entry.title}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{date(entry.timestamp)}</span>
                    {entry.profile && (
                      <span className="truncate">{entry.profile}</span>
                    )}
                    {entry.status && <span>{label(entry.status)}</span>}
                  </div>
                </button>
              ))
            )}
          </section>
          {selected && (
            <article
              aria-label={copy("记忆详情", "Memory detail")}
              className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-6"
            >
              <div className="mb-5 flex items-center justify-between gap-4">
                <span className="text-xs text-muted-foreground">
                  {label(kind)} · {copy("来源与内容", "Source and content")}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={copy("关闭详情", "Close detail")}
                  onClick={() => setSelected(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <h2 className="break-words text-base font-semibold">
                {selected.title}
              </h2>
              <dl className="my-5 space-y-2 border-y border-border py-4 text-xs">
                {[
                  [copy("记录 ID", "Record ID"), selected.id],
                  [copy("来源会话", "Source session"), selected.sessionId],
                  [copy("所属预设", "Agent profile"), selected.profile],
                  [copy("时间", "Time"), date(selected.timestamp)],
                ].map(([title, value]) =>
                  value ? (
                    <div
                      key={title}
                      className="grid grid-cols-[5rem_1fr] gap-3"
                    >
                      <dt className="text-muted-foreground">{title}</dt>
                      <dd className="break-all">{value}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
              {selected.tags.length > 0 && (
                <div className="mb-5 flex flex-wrap gap-2">
                  {selected.tags.map((tag, index) => (
                    <span
                      key={`${tag}-${index}`}
                      className="rounded bg-muted px-2 py-1 text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {selected.sections.map((section) => (
                <section key={section.label} className="mb-6">
                  <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                    {label(section.label)}
                  </h3>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7">
                    {section.text}
                  </p>
                </section>
              ))}
            </article>
          )}
        </div>
        {!error && !loading && page && (
          <footer className="flex shrink-0 items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
            <span>
              {page.total === null
                ? ""
                : copy(`共 ${page.total} 条`, `${page.total} entries`)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 30))}
              >
                <ChevronLeft className="mr-1 h-3 w-3" />
                {copy("上一页", "Previous")}
              </Button>
              <span>{Math.floor(offset / 30) + 1}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page.nextOffset === null}
                onClick={() => {
                  if (page.nextOffset !== null) setOffset(page.nextOffset);
                }}
              >
                {copy("下一页", "Next")}
                <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
