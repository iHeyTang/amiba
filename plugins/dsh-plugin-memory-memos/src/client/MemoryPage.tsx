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
  LockKeyhole,
  ArrowRight,
  Search,
  X,
  Settings2,
} from "lucide-react";
import type {
  MemoryEntry,
  MemoryUpdate,
  MemoryCorrectionRequest,
  MemoryDetail,
  MemoryDetailQuery,
  MemoryKind,
  MemoryOverview,
  MemoryPage as PageData,
  MemoryQuery,
} from "../dashboard.js";

import { memoryTitle, memoryExcerpt } from "./memory-presentation.js";
import { MemoryDetailPane, MemoryStatus } from "./MemoryDetailPane.js";

export interface MemoryAdapter {
  beginCorrection(input: MemoryCorrectionRequest): Promise<string>;
  update(input: MemoryUpdate): Promise<MemoryEntry>;
  detail(query: MemoryDetailQuery): Promise<MemoryDetail>;
  login(password: string): Promise<void>;
  overview(): Promise<MemoryOverview>;
  browse(query: MemoryQuery): Promise<PageData>;
}
export type MemoryPageProps = Partial<PropsRuntime<"amiba.workspace.view">> & {
  adapter: MemoryAdapter;
  expandSidebar(): void;
  openSettings(): void;
  startChat(prompt: string): void;
};
const kinds: MemoryQuery["kind"][] = ["remembered", "traces"];
const labels = {
  remembered: ["记住的事", "Remembered"],
  context: ["背景知识", "Context"],
  approach: ["做事方法", "Ways of working"],
  conversation: ["对话记录", "Conversations"],
  episodes: ["来源片段", "Source episode"],
  confidence: ["可信度", "Confidence"],
  support: ["支持次数", "Supporting evidence"],
  gain: ["收益评分", "Gain"],
  version: ["版本", "Version"],
  trialsAttempted: ["验证次数", "Trials attempted"],
  trialsPassed: ["验证通过", "Trials passed"],
  usageCount: ["使用次数", "Usage count"],
  experienceType: ["经验类型", "Experience type"],
  success_pattern: ["成功经验", "Success pattern"],
  repair_validated: ["已验证修正", "Validated repair"],
  failure_avoidance: ["失败规避", "Failure avoidance"],
  repair_instruction: ["修正建议", "Repair instruction"],
  preference: ["偏好", "Preference"],
  verifier_feedback: ["验证反馈", "Verifier feedback"],
  procedural: ["操作经验", "Procedure"],
  traces: ["对话记录", "Conversations"],
  policies: ["做事方法", "Ways of working"],
  worldModels: ["背景知识", "Context"],
  skills: ["可复用方法", "Reusable approaches"],
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
  startChat,
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
  const [access, setAccess] = useState<"checking" | "required" | "ready">(
    "checking",
  );
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [kind, setKind] = useState<MemoryQuery["kind"]>("remembered");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [offsetHistory, setOffsetHistory] = useState<number[]>([]);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [selected, setSelected] = useState<MemoryEntry | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(input.trim());
      setOffset(0);
      setOffsetHistory([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setPage(null);
    setSelected(null);
    void adapter
      .browse({ kind, query, offset })
      .then((value) => {
        if (current) {
          setPage(value);
          setAccess("ready");
        }
      })
      .catch((cause) => {
        if (current) {
          const message =
            cause instanceof Error ? cause.message : String(cause);
          setError(message);
          setAccess(
            message.includes("MEMOS_AUTH_REQUIRED") ? "required" : "ready",
          );
        }
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
  const errorText = copy(
    "暂时无法读取记忆。请重试，或在记忆设置中检查 MemOS 运行状态。",
    "Memories are unavailable. Retry or check MemOS in memory settings.",
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <header
        className="app-drag flex shrink-0 items-center gap-2 border-b border-border/60 pr-3"
        style={{
          minHeight: chromeHeightPx,
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: sidebarCollapsed ? Math.max(topBarLeftInset, 12) : 10,
        }}
      >
        <SidebarExpandControl
          collapsed={sidebarCollapsed}
          visible={showSidebarExpandControl}
          onExpand={expandSidebar}
        />
        {access === "ready" && (
          <div className="app-no-drag flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <div
              className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
              role="group"
              aria-label={copy("记忆分类", "Memory categories")}
            >
              {kinds.map((value) => (
                <Button
                  key={value}
                  disabled={detailBusy}
                  size="sm"
                  variant={kind === value ? "secondary" : "ghost"}
                  className="h-8 shrink-0 gap-1.5 px-2 text-xs font-normal"
                  aria-pressed={kind === value}
                  onClick={() => {
                    setKind(value);
                    setOffset(0);
                    setOffsetHistory([]);
                    setInput("");
                    setQuery("");
                  }}
                >
                  {label(value)}
                </Button>
              ))}
            </div>
            <div className="relative ml-auto w-36 min-w-0 sm:w-48">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-2 h-4 w-4 text-muted-foreground"
              />
              <Input
                className="h-8 rounded-md border-transparent bg-muted/50 pl-9 pr-7 text-xs focus-visible:bg-background"
                disabled={detailBusy}
                maxLength={512}
                aria-label={copy("搜索当前分类", "Search this category")}
                placeholder={copy("搜索记住的内容…", "Search memories…")}
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
              {input && (
                <button
                  type="button"
                  disabled={detailBusy}
                  aria-label={copy("清空搜索", "Clear search")}
                  className="absolute right-2 top-2 text-muted-foreground"
                  onClick={() => setInput("")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="app-no-drag ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground [&_svg]:size-3.5"
            aria-label={copy("记忆设置", "Memory settings")}
            title={copy("记忆设置", "Memory settings")}
            onClick={openSettings}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          {access === "ready" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground [&_svg]:size-3.5"
              aria-label={copy("刷新记忆", "Refresh memories")}
              disabled={loading || detailBusy}
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
          )}
        </div>
      </header>
      {access === "checking" ? (
        <div
          className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />
          {copy("正在连接记忆库…", "Connecting to your memories…")}
        </div>
      ) : access === "required" ? (
        <main
          className="flex min-h-0 flex-1 overflow-y-auto px-6 py-12"
          aria-labelledby="memory-login-title"
        >
          <div className="m-auto w-full max-w-[360px]">
            <h1
              id="memory-login-title"
              className="flex items-center gap-3 text-2xl font-semibold tracking-tight"
            >
              <LockKeyhole
                aria-hidden="true"
                className="h-5 w-5 shrink-0 text-muted-foreground"
              />
              {copy("进入记忆库", "Enter your memory library")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {copy(
                "记忆库已受密码保护，输入管理密码即可进入。",
                "Your memory library is password protected. Enter your manager password to continue.",
              )}
            </p>
            <form
              className="mt-8 space-y-4"
              aria-busy={signingIn || loading}
              onSubmit={async (event) => {
                event.preventDefault();
                if (signingIn || loading || !password.trim()) return;
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
              <div className="space-y-2">
                <label
                  htmlFor="memory-password"
                  className="text-sm font-medium"
                >
                  {copy("管理密码", "Manager password")}
                </label>
                <Input
                  id="memory-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  aria-invalid={loginError}
                  aria-describedby={
                    loginError ? "memory-login-error" : undefined
                  }
                  placeholder={copy(
                    "请输入管理密码",
                    "Enter your manager password",
                  )}
                  className="h-11"
                  value={password}
                  maxLength={1024}
                  disabled={signingIn || loading}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setLoginError(false);
                  }}
                />
              </div>
              {loginError && (
                <p
                  id="memory-login-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {copy(
                    "验证失败，请检查密码或稍后重试。",
                    "Verification failed. Check your password or try again later.",
                  )}
                </p>
              )}
              <Button
                type="submit"
                className="h-11 w-full gap-2"
                disabled={signingIn || loading || !password.trim()}
              >
                {signingIn || loading ? (
                  <>
                    <RefreshCw
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin"
                    />
                    {copy("正在验证…", "Verifying…")}
                  </>
                ) : (
                  <>
                    {copy("进入", "Enter")}
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
            <p className="mt-6 text-xs leading-5 text-muted-foreground">
              {copy(
                "使用记忆服务中设置的管理密码。",
                "Use the manager password configured for your memory service.",
              )}
            </p>
          </div>
        </main>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <section
              aria-label={copy("记忆列表", "Memory list")}
              aria-busy={loading}
              className={`min-w-0 flex-1 space-y-0.5 overflow-y-auto p-2 md:w-[300px] md:max-w-[36%] md:flex-none md:border-r md:border-border/60 lg:w-[340px] ${selected ? "hidden md:block" : ""}`}
            >
              {loading ? (
                <p role="status" className="p-6 text-sm text-muted-foreground">
                  {copy("正在读取…", "Loading…")}
                </p>
              ) : error ? (
                <div role="alert" className="space-y-3 p-6">
                  <p className="text-sm text-muted-foreground">{errorText}</p>
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
                      : kind === "remembered"
                        ? copy(
                            "还没有提炼出值得保留的记忆",
                            "No lasting memories yet",
                          )
                        : copy("还没有对话记录", "No conversations yet")}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {query
                      ? copy("试试其他关键词。", "Try another search.")
                      : copy(
                          kind === "remembered"
                            ? "对话记录不等于长期记忆。形成可复用的偏好、知识或方法后，会出现在这里。"
                            : "完成一轮对话后，可以在这里回看你的问题、回答与执行过程。",
                          "Memories from your conversations with amiba will appear here.",
                        )}
                  </p>
                </div>
              ) : (
                page?.entries.map((entry) => (
                  <button
                    key={`${entry.kind ?? kind}:${entry.id}`}
                    disabled={detailBusy}
                    onClick={() => setSelected(entry)}
                    aria-pressed={
                      selected?.id === entry.id && selected?.kind === entry.kind
                    }
                    className={`group relative block w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${selected?.id === entry.id && selected?.kind === entry.kind ? "bg-muted/70" : ""}`}
                  >
                    <p className="line-clamp-2 text-[13px] font-medium leading-5">
                      {memoryTitle(entry)}
                    </p>
                    {previewText(entry) && (
                      <p className="mt-1 line-clamp-1 text-[11px] leading-4 text-muted-foreground">
                        {memoryExcerpt(previewText(entry))}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span title={date(entry.timestamp)}>
                        {entry.timestamp === null
                          ? ""
                          : new Date(entry.timestamp).toLocaleDateString(
                              zh ? "zh-CN" : "en-US",
                              { month: "short", day: "numeric" },
                            )}
                      </span>
                      <span>
                        {label(
                          entry.category ??
                            (kind === "traces" ? "conversation" : "approach"),
                        )}
                      </span>
                      {kind === "traces" && entry.stepCount !== undefined && (
                        <span>
                          {copy(
                            `${entry.stepCount} 个执行步骤`,
                            `${entry.stepCount} steps`,
                          )}
                        </span>
                      )}
                      <MemoryStatus status={entry.status} label={label} />
                    </div>
                  </button>
                ))
              )}
            </section>
            {selected ? (
              <MemoryDetailPane
                key={`${entryKind(selected, kind)}:${selected.id}`}
                adapter={adapter}
                entry={selected}
                kind={entryKind(selected, kind)}
                copy={copy}
                label={label}
                startChat={startChat}
                onEditingChange={setDetailBusy}
                onSaved={(updated) => {
                  setSelected((value) =>
                    value?.id === updated.id &&
                    entryKind(value, kind) === updated.kind
                      ? updated
                      : value,
                  );
                  setPage((value) =>
                    value
                      ? {
                          ...value,
                          entries: value.entries.map((item) =>
                            item.id === updated.id &&
                            entryKind(item, kind) === updated.kind
                              ? updated
                              : item,
                          ),
                        }
                      : value,
                  );
                }}
                onClose={() => setSelected(null)}
                onAuthRequired={() => {
                  setSelected(null);
                  setAccess("required");
                }}
              />
            ) : (
              <div className="hidden min-w-0 flex-1 items-center justify-center md:flex">
                <p className="text-xs text-muted-foreground">
                  {copy(
                    "选择一条记忆，看看记住了什么、为什么记住",
                    "Select a record to explore its content and sources",
                  )}
                </p>
              </div>
            )}
          </div>
          {!error && !loading && page && (
            <footer className="flex shrink-0 items-center justify-between border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span>
                {page.total === null
                  ? ""
                  : copy(`共 ${page.total} 条`, `${page.total} entries`)}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={detailBusy || offsetHistory.length === 0}
                  onClick={() => {
                    setOffset(offsetHistory[offsetHistory.length - 1] ?? 0);
                    setOffsetHistory((values) => values.slice(0, -1));
                  }}
                >
                  <ChevronLeft className="mr-1 h-3 w-3" />
                  {copy("上一页", "Previous")}
                </Button>
                <span>{offsetHistory.length + 1}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={detailBusy || page.nextOffset === null}
                  onClick={() => {
                    if (page.nextOffset !== null) {
                      setOffsetHistory((values) => [...values, offset]);
                      setOffset(page.nextOffset);
                    }
                  }}
                >
                  {copy("下一页", "Next")}
                  <ChevronRight className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}

function entryKind(entry: MemoryEntry, view: MemoryQuery["kind"]): MemoryKind {
  return entry.kind ?? (view === "remembered" ? "policies" : view);
}

function previewText(entry: MemoryEntry): string | undefined {
  const preferred =
    entry.kind === "traces"
      ? ["agentText"]
      : ["procedure", "body", "invocationGuide", "summary"];
  return (
    preferred
      .map(
        (key) =>
          entry.sections.find(
            (section) => section.label === key && section.text !== entry.title,
          )?.text,
      )
      .find(Boolean) ??
    entry.sections.find(
      (section) =>
        section.label !== "toolCalls" && section.text !== entry.title,
    )?.text
  );
}
