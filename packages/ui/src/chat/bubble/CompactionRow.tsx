import {
  AlertCircle,
  ChevronRight,
  LoaderCircle,
  Minimize2,
} from "lucide-react";
import type { CompactionProgress } from "@amiba/app-runtime/protocol";
import { useT } from "@amiba/i18n";
import { ChatMarkdown } from "@amiba/markdown";

/** A runtime checkpoint stays in the conversation at its original position. */
export function CompactionRow({
  compaction,
  live,
}: {
  compaction: CompactionProgress;
  live: boolean;
}) {
  const { t } = useT();
  // A history-only opening marker is not proof that the operation is still live.
  const status =
    compaction.status === "running" && !live
      ? "unconfirmed"
      : compaction.status;
  const running = status === "running";
  const failed =
    status === "failed" || status === "interrupted" || status === "unconfirmed";
  const Icon = running ? LoaderCircle : failed ? AlertCircle : Minimize2;
  const summary = compaction.summary?.trim();
  const error = compaction.error?.trim();
  const expandable = Boolean(summary || error);
  const label = (
    <>
      <Icon
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${running ? "motion-safe:animate-spin" : ""}`}
      />
      <span role="status" aria-live="polite">
        {t(`sidepanel.compaction.${status}`)}
      </span>
      {status === "completed" &&
        compaction.shadowedItemCount !== undefined &&
        compaction.shadowedTokenCount !== undefined && (
          <span className="text-muted-foreground/70">
            {t("sidepanel.compaction.stats", {
              items: compaction.shadowedItemCount,
              tokens: Math.round(
                compaction.shadowedTokenCount,
              ).toLocaleString(),
            })}
          </span>
        )}
    </>
  );
  const rowClass =
    "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1 text-xs text-muted-foreground";
  return (
    <div
      data-compaction-id={compaction.compactionId}
      data-compaction-status={status}
      className="min-w-0"
    >
      {expandable ? (
        <details className="group/compaction">
          <summary
            className={`${rowClass} cursor-pointer list-none rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden`}
          >
            {label}
            <ChevronRight
              aria-hidden="true"
              className="size-3 shrink-0 transition-transform group-open/compaction:rotate-90"
            />
          </summary>
          <div className="mt-1 min-w-0 border-l border-border pl-5 text-xs text-muted-foreground">
            {error && (
              <p className="mb-2 whitespace-pre-wrap break-words">{error}</p>
            )}
            {summary && (
              <ChatMarkdown mode="static" className="chat-md break-words">
                {summary}
              </ChatMarkdown>
            )}
          </div>
        </details>
      ) : (
        <div className={rowClass}>{label}</div>
      )}
    </div>
  );
}
