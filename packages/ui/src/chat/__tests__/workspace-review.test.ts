import { describe, expect, it } from "vitest";

import {
  compactWorkspacePath,
  parseWorkspaceReview,
  workspaceReviewResourceFromEvents,
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

  it("understands rendered file headers and aggregates tool calls", () => {
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
    expect(workspaceTabLabel("/repo/apps/desktop/src/main/ipc.ts")).toBe(
      "ipc.ts · main",
    );
  });

  it("keeps file-only tool results visible when no inline diff is available", () => {
    const review = parseWorkspaceReview([
      {
        toolCallId: "tool-1",
        paths: ["src/new-file.ts"],
        diff: "",
      },
    ]);

    expect(review.files).toEqual([
      expect.objectContaining({
        path: "src/new-file.ts",
        additions: 0,
        deletions: 0,
      }),
    ]);
  });

  it("recovers real line counts from a successful apply-patch argument", () => {
    const resource = workspaceReviewResourceFromEvents(
      [
        {
          tool: "edit",
          toolCallId: "patch-1",
          status: "completed",
          args: {
            patch: [
              "*** Begin Patch",
              "*** Update File: src/app.ts",
              "@@",
              " const stable = true",
              "-const label = 'old'",
              "+// Explain why this value is retained.",
              "+const label = 'new'",
              "*** End Patch",
            ].join("\n"),
          },
          result: { files_modified: ["src/app.ts"] },
        },
      ],
      "turn:1",
    );

    expect(resource).not.toBeNull();
    expect(parseWorkspaceReview(resource!.entries)).toMatchObject({
      additions: 2,
      deletions: 1,
      files: [
        expect.objectContaining({
          path: "src/app.ts",
          additions: 2,
          deletions: 1,
        }),
      ],
    });
  });

  it("recovers a tool's JSON-string diff result", () => {
    const resource = workspaceReviewResourceFromEvents(
      [
        {
          tool: "edit",
          toolCallId: "patch-2",
          status: "completed",
          args: { mode: "patch" },
          result: JSON.stringify({
            success: true,
            diff: [
              "--- a/src/plugin.js",
              "+++ b/src/plugin.js",
              "@@ -3,2 +3,4 @@",
              " keep",
              "-old comment",
              "+new comment",
              "+another comment",
              "+final comment",
            ].join("\n"),
          }),
        },
      ],
      "turn:2",
    );

    expect(parseWorkspaceReview(resource!.entries)).toMatchObject({
      additions: 3,
      deletions: 1,
      files: [expect.objectContaining({ path: "src/plugin.js" })],
    });
  });

  it("prefers the applied result and never treats an arrow in code as a file", () => {
    const resource = workspaceReviewResourceFromEvents(
      [
        {
          tool: "edit",
          toolCallId: "patch-3",
          status: "completed",
          args: {
            patch: [
              "*** Begin Patch",
              "*** Update File: src/plugin.js",
              "@@",
              "+// Convert principal (万元 → 元), then calculate.",
              "+const fromSubmittedPatch = true",
              "*** End Patch",
            ].join("\n"),
          },
          result: JSON.stringify({
            success: true,
            diff: [
              "--- a/src/plugin.js",
              "+++ b/src/plugin.js",
              "@@ -1 +1,2 @@",
              " keep",
              "+// Convert principal (万元 → 元), then calculate.",
            ].join("\n"),
          }),
        },
      ],
      "turn:3",
    );
    const review = parseWorkspaceReview(resource!.entries);

    expect(review.files).toHaveLength(1);
    expect(review.files[0]).toMatchObject({
      path: "src/plugin.js",
      additions: 1,
      deletions: 0,
    });
    expect(review).toMatchObject({ additions: 1, deletions: 0 });
  });
});

describe("workspace review derivation cache", () => {
  const editEvent = (overrides = {}) => ({
    toolCallId: "edit-1",
    tool: "edit",
    status: "completed",
    result: { patch: "*** Begin Patch\n*** Update File: a.ts\n@@ -1 +1,2 @@\n keep\n+added" },
    ...overrides,
  });

  it("reuses the same events across frames and returns identical reviews", () => {
    const events = [editEvent()];
    const first = workspaceReviewResourceFromEvents(events, "turn:1")!;
    const second = workspaceReviewResourceFromEvents(events, "turn:1")!;
    expect(second).toEqual(first);
    expect(first.entries[0]!.diff).toContain("*** Begin Patch");
  });

  it("re-derives when a tool event is replaced (new object, e.g. a settle)", () => {
    const running = [editEvent({ status: "running", result: undefined })];
    expect(workspaceReviewResourceFromEvents(running, "turn:1")).toBeNull();
    // A later snapshot replaces the event object with a completed one.
    const completed = [editEvent({ status: "completed" })];
    const review = workspaceReviewResourceFromEvents(completed, "turn:1")!;
    expect(review.entries[0]!.diff).toContain("*** Begin Patch");
  });
});
