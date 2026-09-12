import type { AssistantTimelineItem, StreamEvent } from "../protocol";

type SourceEvent = Extract<StreamEvent, {kind:"assistantTextSource"}>;

/** Keep existing text grouping; metadata arrays are replaced, never mutated. */
export function appendAssistantText(
  timeline: AssistantTimelineItem[], text: string, createId: () => string, runtimeStep?: number,
): void {
  let item = timeline.at(-1);
  if (item?.kind !== "text") {
    item = {kind:"text", id:createId(), text:""};
    timeline.push(item);
  }
  const start = item.text.length;
  if (text && item.runtimeSeq !== undefined) {
    item.sourceRanges = [{start:0,end:start,runtimeSeq:item.runtimeSeq}];
    delete item.runtimeSeq;
  }
  item.text += text;
  if (!text || !Number.isSafeInteger(runtimeStep) || runtimeStep! < 0) return;
  const ranges = item.sourceRanges ?? [];
  const last = ranges.at(-1);
  item.sourceRanges = last && last.end === start && last.runtimeStep === runtimeStep && last.runtimeSeq === undefined
    ? [...ranges.slice(0,-1), {...last, end:item.text.length}]
    : [...ranges, {start,end:item.text.length,runtimeStep:runtimeStep!}];
}

/** Only an exact finalized text match can authorize its source ranges. */
export function applyAssistantTextSource(timeline: AssistantTimelineItem[], event: SourceEvent): void {
  if (!Number.isSafeInteger(event.runtimeStep) || event.runtimeStep < 0) return;
  const textItems = timeline.filter(item => item.kind === "text");
  if (event.phase === "reset") {
    for (const item of textItems) {
      if (item.sourceRanges) item.sourceRanges = item.sourceRanges.filter(range => range.runtimeStep !== event.runtimeStep);
    }
    return;
  }
  if (!Number.isSafeInteger(event.runtimeSeq) || event.runtimeSeq < 0) return;
  const actual = textItems.flatMap(item => (item.sourceRanges ?? [])
    .filter(range => range.runtimeStep === event.runtimeStep)
    .map(range => item.text.slice(range.start, range.end))).join("");
  const exact = !!event.text && actual === event.text;
  for (const item of textItems) {
    if (item.sourceRanges) item.sourceRanges = item.sourceRanges.map(range => {
      if (range.runtimeStep !== event.runtimeStep) return range;
      const {runtimeSeq: _previous, ...pending} = range;
      return exact ? {...pending,runtimeSeq:event.runtimeSeq} : pending;
    });
  }
}
