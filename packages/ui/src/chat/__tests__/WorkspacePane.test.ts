import type { HermesToolProgress } from "@amiba/core";
import { describe, expect, it } from "vitest";

import {
  canInspectWorkspaceTool,
  canMutateWorkspaceTool,
  workspaceCodeExecution,
  workspaceFileTargets,
} from "../WorkspacePane";

function event(
  partial: Partial<HermesToolProgress> & Pick<HermesToolProgress, "tool">,
): HermesToolProgress {
  return {
    toolCallId: "tool-1",
    status: "completed",
    ...partial,
  };
}

describe("workspace pane tool resources", () => {
  it("opens a read_file argument at its requested path", () => {
    const toolEvent = event({
      tool: "read_file",
      args: { path: "src/App.tsx", offset: 20 },
    });

    expect(canInspectWorkspaceTool(toolEvent)).toBe(true);
    expect(workspaceFileTargets(toolEvent)).toEqual(["src/App.tsx"]);
  });

  it("prefers Hermes' authoritative resolved write path", () => {
    const toolEvent = event({
      tool: "write_file",
      args: { path: "src/App.tsx" },
      result: {
        resolved_path: "/workspace/src/App.tsx",
        files_modified: ["/workspace/src/App.tsx"],
      },
    });

    expect(workspaceFileTargets(toolEvent)).toEqual([
      "/workspace/src/App.tsx",
      "src/App.tsx",
    ]);
  });

  it("collects every file reported by a multi-file patch", () => {
    const toolEvent = event({
      tool: "patch",
      result: JSON.stringify({
        files_modified: ["/workspace/src/App.tsx", "/workspace/src/styles.css"],
      }),
    });

    expect(workspaceFileTargets(toolEvent)).toEqual([
      "/workspace/src/App.tsx",
      "/workspace/src/styles.css",
    ]);
  });

  it("does not treat terminal calls as workspace file resources", () => {
    const toolEvent = event({
      tool: "terminal",
      args: { command: "pnpm test" },
    });

    expect(canInspectWorkspaceTool(toolEvent)).toBe(false);
    expect(workspaceFileTargets(toolEvent)).toEqual([]);
  });

  it("treats write and command tools as potentially workspace-mutating", () => {
    expect(canMutateWorkspaceTool(event({ tool: "write_file" }))).toBe(true);
    expect(canMutateWorkspaceTool(event({ tool: "patch" }))).toBe(true);
    expect(canMutateWorkspaceTool(event({ tool: "terminal" }))).toBe(true);
    expect(canMutateWorkspaceTool(event({ tool: "execute_code" }))).toBe(true);
    expect(canMutateWorkspaceTool(event({ tool: "read_file" }))).toBe(false);
  });

  it("turns execute_code into a semantic workbench resource", () => {
    const toolEvent = event({
      tool: "execute_code",
      args: {
        language: "typescript",
        code: "console.log(42)",
        workdir: "/workspace",
      },
      result: {
        stdout: "42\n",
        stderr: "",
        exit_code: 0,
      },
      durationMs: 84,
    });

    expect(canInspectWorkspaceTool(toolEvent)).toBe(true);
    expect(workspaceCodeExecution(toolEvent)).toEqual({
      kind: "code",
      toolCallId: "tool-1",
      language: "typescript",
      code: "console.log(42)",
      output: "42",
      workdir: "/workspace",
      exitCode: 0,
      failed: false,
      status: "completed",
      durationMs: 84,
    });
  });

  it("defaults Hermes execute_code previews to Python syntax", () => {
    const toolEvent = event({
      tool: "execute_code",
      args: {
        code: "from pathlib import Path\nprint(Path.cwd())",
      },
      result: {
        stdout: "/workspace\n",
        exit_code: 0,
      },
    });

    expect(workspaceCodeExecution(toolEvent)).toMatchObject({
      language: "python",
      code: "from pathlib import Path\nprint(Path.cwd())",
    });
  });

  it("marks non-zero code executions as failed", () => {
    const toolEvent = event({
      tool: "execute_code",
      args: { language: "python", code: "raise ValueError()" },
      result: { stderr: "ValueError", exit_code: 1 },
    });

    expect(workspaceCodeExecution(toolEvent)).toMatchObject({
      output: "ValueError",
      exitCode: 1,
      failed: true,
    });
  });
});
