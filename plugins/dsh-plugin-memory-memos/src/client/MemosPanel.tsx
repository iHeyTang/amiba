import { useCallback, useEffect, useId, useState } from "react";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import {
  Button,
  PageContent,
  ScrollArea,
  SettingsPageActionButton,
  SettingsPageActions,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  usePluginT,
} from "@amiba/ui/plugin";
import {
  Brain,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { MemosStatus } from "../memos-status.js";

export interface MemosPanelProps {
  getStatus: () => Promise<RemoteResult<MemosStatus>>;
}

/** Only the local manager address may leave the app through this entry. */
function viewerAddress(status: MemosStatus | null): string | null {
  if (status?.state !== "ready" || !status.viewerUrl) return null;
  try {
    const url = new URL(status.viewerUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function MemosPanel({ getStatus }: MemosPanelProps) {
  const { language } = usePluginT();
  const zh = language === "zh-CN";
  const [status, setStatus] = useState<MemosStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const helpId = useId();
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getStatus();
      if (!result.ok) throw new Error(result.error.message);
      setStatus(result.value);
      setError(null);
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [getStatus]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (status?.state !== "starting") return;
    const timer = setTimeout(() => void refresh(), 1500);
    return () => clearTimeout(timer);
  }, [status, refresh]);
  const stateLabel = error
    ? zh
      ? "状态不可用"
      : "Status unavailable"
    : status
      ? {
          starting: zh ? "正在启动" : "Starting",
          ready: zh ? "运行中" : "Running",
          error: zh ? "启动失败" : "Failed to start",
          stopped: zh ? "已停止" : "Stopped",
        }[status.state]
      : zh
        ? "正在读取状态"
        : "Loading status";
  const viewerUrl = viewerAddress(status);
  const failure =
    error ??
    status?.error ??
    (status?.state === "ready" && !viewerUrl
      ? zh
        ? "本地记忆管理地址不可用。"
        : "The local memory manager address is unavailable."
      : null);
  const openLabel = zh ? "在浏览器中打开" : "Open in browser";
  const refreshLabel = zh ? "刷新状态" : "Refresh status";
  const pending = !error && (!status || status.state === "starting");
  const failed = Boolean(error) || status?.state === "error";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <SettingsPageActions>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <SettingsPageActionButton
                icon
                variant="ghost"
                disabled={loading}
                onClick={() => void refresh()}
                aria-label={refreshLabel}
              >
                {loading ? (
                  <Loader2
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
              </SettingsPageActionButton>
            </TooltipTrigger>
            <TooltipContent>{refreshLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </SettingsPageActions>
      <ScrollArea className="min-h-0 flex-1">
        <PageContent size="md" bodyClassName="space-y-6">
          <section
            aria-label={zh ? "记忆状态" : "Memory status"}
            className="space-y-5 rounded-xl bg-muted/50 p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Brain
                  aria-hidden="true"
                  className="size-5 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <h3 className="text-base font-medium tracking-tight">MemOS</h3>
              </div>
              <span
                role="status"
                className={`inline-flex items-center gap-2 text-[13px] ${failed ? "text-destructive" : "text-muted-foreground"}`}
              >
                {pending ? (
                  <Loader2
                    aria-hidden="true"
                    className="size-3 animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${failed ? "bg-destructive" : status?.state === "ready" ? "bg-[hsl(var(--success))]" : "bg-muted-foreground/50"}`}
                  />
                )}
                {stateLabel}
              </span>
            </div>
            <p className="text-sm leading-relaxed">
              {zh
                ? "自动记下对话中的经验，在后续任务中找回相关记忆。"
                : "Remember experience from conversations and recall it in later tasks."}
            </p>
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
              <div className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">
                  {zh ? "数据存储" : "Storage"}
                </dt>
                <dd>{zh ? "本机" : "This device"}</dd>
              </div>
              {status ? (
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground">
                    {zh ? "记忆模式" : "Memory mode"}
                  </dt>
                  <dd>
                    {status.mode === "full"
                      ? zh
                        ? "完整模式"
                        : "Full mode"
                      : zh
                        ? "轻量模式"
                        : "Lightweight mode"}
                  </dd>
                </div>
              ) : null}
            </dl>
            {failure ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p
                  role="alert"
                  className="min-w-0 flex-1 break-words text-[13px] text-destructive"
                >
                  {failure}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  {zh ? "重试" : "Retry"}
                </Button>
              </div>
            ) : null}
          </section>
          <section
            aria-label={zh ? "记忆管理" : "Memory management"}
            className="flex flex-wrap items-center justify-between gap-4"
          >
            <div className="min-w-0 flex-1 basis-64 space-y-1.5">
              <h3 className="text-sm font-medium">
                {zh ? "记忆管理" : "Memory management"}
              </h3>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {zh
                  ? "查看记忆、管理经验和调整设置。关闭管理页不影响自动记忆。"
                  : "View memories, manage experience and adjust settings. Automatic memory keeps working after you close the page."}
              </p>
            </div>
            {viewerUrl ? (
              <Button asChild variant="outline" className="shrink-0">
                <a href={viewerUrl} target="_blank" rel="noopener noreferrer">
                  {openLabel}
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            ) : (
              <Button disabled variant="outline" className="shrink-0">
                {openLabel}
                <ExternalLink aria-hidden="true" />
              </Button>
            )}
          </section>
          <div>
            <Button
              variant="ghost"
              className="-ml-2 h-8 gap-1.5 px-2 text-[13px] font-normal text-muted-foreground"
              aria-expanded={showHelp}
              aria-controls={helpId}
              onClick={() => setShowHelp((value) => !value)}
            >
              <ChevronRight
                aria-hidden="true"
                className={`transition-transform duration-150 motion-reduce:transition-none ${showHelp ? "rotate-90" : ""}`}
              />
              {zh ? "使用说明" : "Good to know"}
            </Button>
            <div
              id={helpId}
              hidden={!showHelp}
              className="space-y-3 pl-5 pt-3 text-[13px] leading-relaxed text-muted-foreground"
            >
              <p>
                {zh
                  ? "首次打开时，在管理页设置本地访问密码即可，无需注册云账号。"
                  : "On first use, set a local access password in the manager. No cloud account is required."}
              </p>
              <p>
                {zh
                  ? "记忆保存在本机；整理与检索时可能调用当前配置的模型。"
                  : "Memories are stored on this device. Processing and retrieval may use your configured model."}
              </p>
              <p>
                {zh
                  ? "在管理页修改配置后，需重启 Amiba 才会生效。"
                  : "Restart Amiba after changing configuration in the manager."}
              </p>
            </div>
          </div>
        </PageContent>
      </ScrollArea>
    </div>
  );
}
