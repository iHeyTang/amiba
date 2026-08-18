import { describe, expect, it } from "vitest";

import { splitProcessFromResult } from "../turn-presentation";
import type { AssistantTimelineItem } from "../types";

const text = (id: string, t: string): AssistantTimelineItem => ({
  kind: "text",
  id,
  text: t,
});
const tool = (id: string, toolCallId: string): AssistantTimelineItem => ({
  kind: "tool",
  id,
  toolCallId,
});

describe("splitProcessFromResult", () => {
  it("treats the trailing text run as the result and the rest as process", () => {
    const timeline = [
      text("t1", "我先看一下项目结构。"),
      tool("x1", "call-1"),
      text("t2", "最终答案第一段。"),
      text("t3", "最终答案第二段。"),
    ];
    const split = splitProcessFromResult(timeline, "ignored");
    expect(split.resultText).toBe("最终答案第一段。最终答案第二段。");
    expect(split.processItems).toEqual([timeline[0], timeline[1]]);
  });

  it("returns the whole content as result when there is no tool activity", () => {
    const timeline = [text("t1", "直接回答。")];
    const split = splitProcessFromResult(timeline, "直接回答。");
    expect(split.resultText).toBe("直接回答。");
    expect(split.processItems).toEqual([]);
  });

  it("falls back to content when the timeline is empty", () => {
    const split = splitProcessFromResult([], "纯文本回答");
    expect(split.resultText).toBe("纯文本回答");
    expect(split.processItems).toEqual([]);
  });

  it("yields an empty result for silent endings (tools last)", () => {
    const timeline = [
      text("t1", "我来跑一下构建。"),
      tool("x1", "call-1"),
    ];
    const split = splitProcessFromResult(timeline, "我来跑一下构建。");
    expect(split.resultText).toBe("");
    expect(split.processItems).toEqual(timeline);
  });

  it("keeps interleaved narration in process order across multiple steps", () => {
    const timeline = [
      text("t1", "步骤一说明。"),
      tool("x1", "call-1"),
      text("t2", "步骤二说明。"),
      tool("x2", "call-2"),
      text("t3", "总结。"),
    ];
    const split = splitProcessFromResult(timeline, "ignored");
    expect(split.resultText).toBe("总结。");
    expect(split.processItems.map((item) => item.id)).toEqual([
      "t1",
      "x1",
      "t2",
      "x2",
    ]);
  });
});
