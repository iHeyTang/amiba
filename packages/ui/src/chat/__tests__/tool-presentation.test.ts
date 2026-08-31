import { describe, expect, it } from "vitest";

import type { TranslateFn } from "@amiba/i18n";

import { describeToolCall, hasToolDetail } from "../bubble/tool-presentation";

const t = ((key: string) => key) as TranslateFn;

describe("generic tool presentation", () => {
  it("names the call by its semantic argument, never a tool table", () => {
    const presentation = describeToolCall(
      {
        tool: "some_plugin_tool",
        toolCallId: "call-1",
        status: "completed",
        args: { path: "server/index.html" },
      },
      t,
    );
    expect(presentation.action).toBe("sidepanel.trace.actions.useTool");
    expect(presentation.target).toBe("server/index.html");
  });

  it("falls back to the wire tool name when no argument is semantic", () => {
    const presentation = describeToolCall(
      {
        tool: "mystery_tool",
        toolCallId: "call-2",
        status: "completed",
        args: { flag: true },
      },
      t,
    );
    expect(presentation.target).toBe("mystery_tool");
  });

  it("offers detail exactly when there is a result or a failure", () => {
    expect(
      hasToolDetail({ tool: "x", toolCallId: "a", status: "running" }),
    ).toBe(false);
    expect(
      hasToolDetail({
        tool: "x",
        toolCallId: "a",
        status: "completed",
        result: "ok",
      }),
    ).toBe(true);
    expect(
      hasToolDetail({
        tool: "x",
        toolCallId: "a",
        status: "completed",
        error: true,
      }),
    ).toBe(true);
  });
});
