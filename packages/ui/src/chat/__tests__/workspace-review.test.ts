import { describe, expect, it } from "vitest";

import {
  compactWorkspacePath,
  parseWorkspaceReview,
  workspaceTabLabel,
} from "../workspace-review";

describe("workspace review parser", () => {
  it("parses a unified diff into double-sided line numbers", () => {
    const review = parseWorkspaceReview([
      {
        toolCallId: "tool-1",
        paths: ["src/app.ts"],
        diff: [
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -4,3 +4,3 @@",
          " const value = 1",
          "-oldValue()",
          "+newValue()",
          " return value",
        ].join("\n"),
      },
    ]);

    expect(review.files).toHaveLength(1);
    expect(review.files[0]?.path).toBe("src/app.ts");
    expect(review.files[0]?.rows).toEqual([
      { kind: "gap", oldStart: 1, newStart: 1, count: 3 },
      {
        kind: "context",
        content: "const value = 1",
        oldLine: 4,
        newLine: 4,
      },
      {
        kind: "deletion",
        content: "oldValue()",
        oldLine: 5,
        newLine: null,
      },
      {
        kind: "addition",
        content: "newValue()",
        oldLine: null,
        newLine: 5,
      },
      {
        kind: "context",
        content: "return value",
        oldLine: 6,
        newLine: 6,
      },
    ]);
    expect(review.additions).toBe(1);
    expect(review.deletions).toBe(1);
  });

  it("understands Hermes rendered file headers and aggregates tool calls", () => {
    const review = parseWorkspaceReview([
      {
        toolCallId: "tool-1",
        paths: ["/workspace/src/app.ts"],
        diff: "  ┊ review diff\na/src/app.ts → b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
      },
      {
        toolCallId: "tool-2",
        paths: ["/workspace/src/style.css"],
        diff: "a/src/style.css → b/src/style.css\n@@ -2 +2 @@\n-red\n+blue",
      },
    ]);

    expect(review.files.map((file) => file.path)).toEqual([
      "src/app.ts",
      "src/style.css",
    ]);
    expect(review.additions).toBe(2);
    expect(review.deletions).toBe(2);
  });

  it("keeps a useful amount of path context in tabs", () => {
    expect(compactWorkspacePath("/repo/apps/desktop/src/main/ipc.ts")).toBe(
      "desktop/src/main/ipc.ts",
    );
    expect(
      workspaceTabLabel("/repo/apps/desktop/src/main/ipc.ts"),
    ).toBe("ipc.ts · main");
  });
});
