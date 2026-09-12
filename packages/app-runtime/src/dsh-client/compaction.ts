import type {
  AssistantTimelineItem,
  CompactionUpdate,
} from "../protocol/index.js";
import type { DshSessionEvent } from "./index.js";

/** Both replay and live transport use the same DSH lifecycle interpretation. */
export function compactionUpdate(
  event: Pick<DshSessionEvent, "type" | "data" | "time">,
): CompactionUpdate | null {
  const { data, type, time } = event;
  if (
    !type.startsWith("compaction/") ||
    typeof data.compactionId !== "string" ||
    !data.compactionId
  )
    return null;
  const compactionId = data.compactionId;
  if (type === "compaction/start")
    return { compactionId, status: "running", startedAt: time };
  if (type === "compaction/end") {
    const error = data.error;
    return {
      compactionId,
      status: error == null ? "completed" : "failed",
      endedAt: time,
      ...(error == null ? {} : { error: errorText(error) }),
    };
  }
  if (type !== "compaction/summary") return null;
  return {
    compactionId,
    ...(Array.isArray(data.summary)
      ? {
          summary: data.summary
            .map((block) =>
              block?.type === "text" && typeof block.text === "string"
                ? block.text
                : "",
            )
            .filter(Boolean)
            .join("\n"),
        }
      : {}),
    ...(Array.isArray(data.shadowedSeqs)
      ? { shadowedItemCount: data.shadowedSeqs.length }
      : {}),
    ...(typeof data.shadowedTokenCount === "number" &&
    Number.isFinite(data.shadowedTokenCount)
      ? { shadowedTokenCount: data.shadowedTokenCount }
      : {}),
  };
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (Array.isArray(error))
    return error.map(errorText).filter(Boolean).join("\n");
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "";
}

/** Replace the item, never mutate a snapshot already published to React. */
export function upsertCompactionTimeline(
  timeline: AssistantTimelineItem[],
  update: CompactionUpdate,
): void {
  const index = timeline.findIndex(
    (item) =>
      item.kind === "compaction" &&
      item.compaction.compactionId === update.compactionId,
  );
  const existing = timeline[index];
  const prior =
    existing?.kind === "compaction" ? existing.compaction : undefined;
  const compaction = { status: "running" as const, ...prior, ...update };
  // Replayed opening evidence must not restart an already settled operation.
  if (prior && prior.status !== "running" && update.status === "running")
    compaction.status = prior.status;
  const item: AssistantTimelineItem = {
    kind: "compaction",
    id: `dsh:compaction:${update.compactionId}`,
    compaction,
  };
  if (index < 0) timeline.push(item);
  else timeline[index] = item;
}

/** A closed turn cannot leave an endless compression spinner. */
export function interruptOpenCompactions(
  timeline: AssistantTimelineItem[],
): void {
  for (let index = 0; index < timeline.length; index++) {
    const item = timeline[index]!;
    if (item.kind === "compaction" && item.compaction.status === "running") {
      timeline[index] = {
        ...item,
        compaction: { ...item.compaction, status: "interrupted" },
      };
    }
  }
}
