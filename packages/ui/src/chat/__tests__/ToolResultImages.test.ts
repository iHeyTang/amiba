import { describe, expect, it } from "vitest";
import type { ToolProgress } from "@amiba/app-runtime/core";
import { toolCallBlockFromProgress, toolCallResultImages, toolCallResultText } from "../bubble/tool-call-block";

const image = { attachmentId: "authorized-image", mediaType: "image/png", bytes: 123, width: 1, height: 1 };
function row(content?: unknown[]): ToolProgress {
  return {
    toolCallId: "call", tool: "read_image", status: content ? "completed" : "running",
    wire: {
      call: { argsRaw: "{}", turn: 1, step: 1, time: 100, callView: null },
      ...(content ? { result: { seq: 2, time: 200, content, isError: false, resultView: null } } : {}),
    },
  };
}

describe("tool image evidence", () => {
  it("preserves image identity, order and repeated occurrences without changing text", () => {
    const second = { ...image, attachmentId: "second" };
    const block = toolCallBlockFromProgress(row([
      { type: "text", text: "before" }, { type: "image", attachment: image },
      { type: "image", attachment: second }, { type: "image", attachment: image },
      { type: "text", text: "after" },
    ]))!;
    const images = toolCallResultImages(block);
    expect(images).toEqual([{ attachment: image }, { attachment: second }, { attachment: image }]);
    expect(images[0]?.attachment).toBe(image);
    expect(toolCallResultText(block)).toBe("beforeafter");
  });
  it("does not read child result images into a running or settled parent", () => {
    const child = toolCallBlockFromProgress(row([{ type: "image", attachment: image }]))!;
    for (const parent of [toolCallBlockFromProgress(row())!, toolCallBlockFromProgress(row([]))!]) {
      expect(toolCallResultImages({ ...parent, subCalls: [child] })).toEqual([]);
    }
    expect(toolCallResultImages(child)).toEqual([{ attachment: image }]);
  });
  it("ignores inline, preview and staging data until they have a supported durable identity", () => {
    const block = toolCallBlockFromProgress(row([
      { type: "image", data: "AAAA", mediaType: "image/png" },
      { type: "image", preview: { url: "blob:unowned" } },
      { type: "image", attachment: { attachmentId: "staging" } },
      { type: "image", attachment: { ...image, width: 0 } },
    ]))!;
    expect(toolCallResultImages(block)).toEqual([]);
  });
});
