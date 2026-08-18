import type { AssistantTimelineItem } from "./types";

export interface ProcessResultSplit {
  /** Everything before the trailing text run: narration + tools + approvals. */
  processItems: AssistantTimelineItem[];
  /** The trailing text run — the turn's result, by loop structure. */
  resultText: string;
}

/**
 * Split a turn's timeline into process and result.
 *
 * The agent loop ends when the model emits text without calling another
 * tool, so the consecutive text items at the TAIL of the timeline are the
 * result — structurally, not heuristically. Everything before them
 * (earlier narration, tool calls, approvals) is process.
 *
 * The same shape is produced by the live engine and the history
 * projection, so this one function serves both hosts. When the timeline
 * carries no non-text activity (single-step answers) or is empty, the
 * plain `content` is the result and there is no process.
 */
/**
 * Split any kinded sequence at its trailing "text" run. The single
 * implementation of the process/result cut — used on raw timelines here
 * and on resolved flow segments in the bubble renderer.
 */
export function splitTrailingTextRun<T extends { kind: string }>(
  items: readonly T[],
): { head: T[]; tail: T[] } {
  let first = items.length;
  while (first > 0 && items[first - 1]!.kind === "text") first -= 1;
  return { head: items.slice(0, first), tail: items.slice(first) };
}

export function splitProcessFromResult(
  timeline: readonly AssistantTimelineItem[],
  content: string,
): ProcessResultSplit {
  if (timeline.length === 0) {
    return { processItems: [], resultText: content };
  }
  const { head, tail } = splitTrailingTextRun(timeline);
  if (head.length === 0) {
    // Pure-text timeline: the whole message is the result.
    return { processItems: [], resultText: content };
  }
  const resultText = tail
    .map((item) => (item.kind === "text" ? item.text : ""))
    .join("");
  return { processItems: head, resultText };
}
