import { describe, expect, it } from "vitest";

import type { TranslateFn } from "@amiba/i18n";

import {
  describeToolCall,
  parseFileSearchResult,
} from "../bubble/tool-presentation";

const t = ((key: string) => key) as TranslateFn;

describe("file tool targets", () => {
  it("keeps a short parent path when it remains compact", () => {
    const presentation = describeToolCall(
      {
        tool: "read_file",
        toolCallId: "read-short",
        status: "completed",
        args: { path: "server/index.html" },
      },
      t,
    );

    expect(presentation.target).toBe("server/index.html");
  });

  it("keeps as much trailing path context as the row can afford", () => {
    const presentation = describeToolCall(
      {
        tool: "read_file",
        toolCallId: "read-long",
        status: "completed",
        args: {
          path: "/Users/demo/session-1865769231056983-97098a6954064022b54fb8e30b67bc4d/package.json",
        },
      },
      t,
    );

    expect(presentation.target).toMatch(/^…\/.+\/package\.json$/);
    expect(presentation.target.length).toBeLessThanOrEqual(34);
  });
});

describe("file search presentation", () => {
  it("parses file results with Hermes' pagination hint suffix", () => {
    const result = parseFileSearchResult(
      '{"files":["src/App.tsx","src/lib/api.ts"],"total_count":8,"truncated":true}\n\n[Hint: Results truncated.]',
    );

    expect(result).toMatchObject({
      totalCount: 8,
      truncated: true,
      entries: [
        { path: "src/App.tsx", count: null, matches: [] },
        { path: "src/lib/api.ts", count: null, matches: [] },
      ],
    });
  });

  it("parses path-grouped content matches", () => {
    const result = parseFileSearchResult({
      output: JSON.stringify({
        total_count: 3,
        matches_text:
          "src/App.tsx\n  12: const app = createApp()\n  28: app.mount()\nsrc/main.ts\n  4: createApp(App)",
        matches_format: "path-grouped",
      }),
    });

    expect(result?.entries).toEqual([
      {
        path: "src/App.tsx",
        count: null,
        matches: [
          { line: 12, content: "const app = createApp()" },
          { line: 28, content: "app.mount()" },
        ],
      },
      {
        path: "src/main.ts",
        count: null,
        matches: [{ line: 4, content: "createApp(App)" }],
      },
    ]);
  });

  it("turns count mode into per-file entries", () => {
    const result = parseFileSearchResult({
      counts: { "src/App.tsx": 3, "src/main.ts": 1 },
      total_count: 4,
    });

    expect(result?.entries).toEqual([
      { path: "src/App.tsx", count: 3, matches: [] },
      { path: "src/main.ts", count: 1, matches: [] },
    ]);
  });
});
