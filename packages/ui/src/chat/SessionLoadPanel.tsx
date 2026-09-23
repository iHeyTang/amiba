import { useEffect, useState } from "react";
import { ChevronRight, RotateCw } from "lucide-react";
import { Button } from "../primitives/button";
import { AmibaLogo } from "../primitives/AmibaLogo";
import { EmptyStateVisual } from "../primitives/empty-state-visual";

/** An unavailable conversation stays in its workspace, with a quiet recovery surface. */
export function SessionLoadPanel({ error, language, retrying = false, onRetry, onHome }: {
  error?: string;
  retrying?: boolean;
  language: string;
  onRetry: () => void;
  onHome: () => void;
}) {
  const [retryFeedback, setRetryFeedback] = useState(false);
  // Keep feedback visible even when the request fails within a single frame.
  useEffect(() => {
    if (!retryFeedback || retrying) return;
    const timer = setTimeout(() => setRetryFeedback(false), 450);
    return () => clearTimeout(timer);
  }, [retryFeedback, retrying]);
  const retryBusy = retrying || retryFeedback;
  const zh = language === "zh-CN";
  const incompatible = Boolean(error && /unsupported|incompatible|unknown historical event|migration refuses/i.test(error));
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto px-6 py-12" role={error === undefined ? "status" : "alert"}>
      <div data-background-surface="recovery" className="m-auto w-full max-w-sm rounded-2xl border border-border/45 px-6 py-7 text-center text-foreground">
        <div className="mx-auto mb-4 flex h-28 items-center justify-center">
          <EmptyStateVisual scene="conversation"><AmibaLogo size={80} /></EmptyStateVisual>
        </div>
        <h2 className="text-[17px] font-medium tracking-tight text-foreground">
          {error === undefined ? (zh ? "正在打开会话" : "Opening conversation")
            : incompatible ? (zh ? "这段会话暂时无法打开" : "This conversation is unavailable")
            : (zh ? "会话加载失败" : "Couldn't load this conversation")}
        </h2>
        <p className="mx-auto mt-2 max-w-xs whitespace-pre-line text-[13px] leading-6 text-foreground/80">
          {error === undefined ? (zh ? "正在读取会话记录，请稍候。" : "Reading your conversation. One moment.")
            : incompatible ? (zh ? "当前版本不支持这段会话的格式。\n你可以开始新任务，或查看问题详情。" : "This conversation's format isn't supported in this version. Start a new task or view the details below.")
            : (zh ? "读取记录时遇到了问题。\n你可以重新尝试，或开始新任务。" : "We couldn't read the conversation. Try again or start a new task.")}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {error !== undefined && <Button size="sm" variant={incompatible ? "secondary" : "default"} disabled={retryBusy} aria-busy={retryBusy} onClick={() => { setRetryFeedback(true); onRetry(); }} className="h-9 rounded-lg px-4 text-[13px]">
            <RotateCw aria-hidden className={`!size-3.5 ${retryBusy ? "animate-spin motion-reduce:animate-none" : ""}`} style={retryBusy ? { animationDuration: "450ms" } : undefined} />{zh ? "重试" : "Retry"}
          </Button>}
          <Button size="sm" variant={incompatible ? "default" : "ghost"} onClick={onHome} className="h-9 rounded-lg px-4 text-[13px]">
            {zh ? "返回新任务" : "New task"}
          </Button>
        </div>
        {error !== undefined && <details className="group relative mt-7 text-left">
          <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1 rounded text-xs text-foreground/75 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-3 transition-transform group-open:rotate-90" />
            {zh ? "错误详情" : "Error details"}
          </summary>
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-chat-surface p-4 font-mono text-[11px] leading-5 text-foreground/80">{error}</pre>
        </details>}
      </div>
    </div>
  );
}
