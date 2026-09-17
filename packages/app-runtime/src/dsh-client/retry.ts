import type { AssistantTimelineItem, RetryProgress } from "../protocol";

/** The durable native retry events are shared by live rendering and history. */
export function retryProgress(event: {
  type: string;
  time: number;
  data: Record<string, unknown>;
}): RetryProgress | null {
  const { data, type } = event;
  if (type !== "llm/retry" && type !== "llm/retry-started") return null;
  if (
    typeof data.retryId !== "string" ||
    !Number.isSafeInteger(data.retry) ||
    (data.retry as number) < 1
  )
    return null;
  return {
    id: `${data.retryId}:${data.retry}`,
    attempt: data.retry as number,
    delayMs:
      typeof data.delayMs === "number" && Number.isFinite(data.delayMs)
        ? Math.max(0, data.delayMs)
        : 0,
    startedAt: event.time,
    status: type === "llm/retry" ? "waiting" : "started",
  };
}

export function upsertRetryTimeline(
  timeline: AssistantTimelineItem[],
  retry: RetryProgress,
): void {
  const index = timeline.findIndex(
    (item) => item.kind === "retry" && item.retry.id === retry.id,
  );
  const prior = timeline[index];
  if (prior?.kind === "retry") {
    if (prior.retry.status === "started" && retry.status === "waiting") return;
    timeline[index] = {
      ...prior,
      retry: { ...prior.retry, status: retry.status },
    };
  } else timeline.push({ kind: "retry", id: `dsh:retry:${retry.id}`, retry });
}
